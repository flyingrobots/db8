import { describe, it, expect } from 'vitest';
import { VerificationService } from '../services/VerificationService.js';
import { VerifySubmit } from '../schemas.js';

// A configured database that fails is a durability failure, not an invitation to
// accept the verdict into memory and report success. Silently downgrading means
// a judge is told their verdict was recorded when it was not, and it disappears
// on restart.
//
// Memory remains a first-class mode — it is simply chosen by configuration, not
// arrived at by accident when a query errors.

const named = (name) => ({ kind: 'named', name });
const TERM = {
  kind: 'framed',
  frame: { kind: 'attribution', source: named('the_study') },
  body: {
    kind: 'claim',
    subject: named('remote_work'),
    predicate: 'reduces',
    object: 'productivity'
  }
};

const verdict = (over = {}) => ({
  round_id: '00000000-0000-0000-0000-0000000000a1',
  reporter_id: '00000000-0000-0000-0000-0000000000a2',
  submission_id: 'sub-1',
  claim_id: 'c1',
  verdict: 'false',
  client_nonce: 'nonce-durability',
  ...over
});

const indexWith = (claims) => new Map([['sub-1', { room_id: 'room-1', claims }]]);

function failingPool(message = 'connection reset') {
  return {
    query: async () => {
      throw new Error(message);
    }
  };
}

describe('a configured database that fails does not silently degrade', () => {
  it('surfaces the failure instead of accepting the verdict into memory', async () => {
    const service = new VerificationService({
      dbRef: { pool: failingPool() },
      memVerifications: new Map(),
      memSubmissionIndex: indexWith([{ id: 'c1', term: TERM }])
    });

    await expect(service.submitVerdict(verdict())).rejects.toThrow(/database_unavailable/);
    // Nothing was written to the memory store on the way out.
    expect(service.memVerifications.size).toBe(0);
  });

  it('surfaces the failure for a path verdict the same way', async () => {
    const service = new VerificationService({
      dbRef: { pool: failingPool() },
      memVerifications: new Map(),
      memSubmissionIndex: indexWith([{ id: 'c1', term: TERM }])
    });

    await expect(service.submitVerdict(verdict({ claim_path: '$.body' }))).rejects.toThrow(
      /database_unavailable/
    );
  });

  it('surfaces the failure on the summary read too', async () => {
    const service = new VerificationService({
      dbRef: { pool: failingPool() },
      memVerifications: new Map(),
      memSubmissionIndex: new Map()
    });

    await expect(service.getSummary('round-1')).rejects.toThrow(/database_unavailable/);
  });

  it('still uses memory when no database is configured', async () => {
    const service = new VerificationService({
      dbRef: { pool: null },
      memVerifications: new Map(),
      memSubmissionIndex: indexWith([{ id: 'c1', term: TERM }])
    });

    const result = await service.submitVerdict(verdict());
    expect(result.id).toBeTruthy();
  });
});

describe('a claim_path must be anchored to a claim that exists', () => {
  const service = () =>
    new VerificationService({
      dbRef: { pool: null },
      memVerifications: new Map(),
      memSubmissionIndex: indexWith([{ id: 'c1', term: TERM }])
    });

  it('rejects a path whose claim_id names no claim in the submission', async () => {
    await expect(
      service().submitVerdict(verdict({ claim_id: 'does-not-exist', claim_path: '$.body' }))
    ).rejects.toThrow(/claim_not_found/);
  });

  it('rejects a path that resolves to no node, on the memory path', async () => {
    await expect(
      service().submitVerdict(verdict({ claim_path: '$.parts[99].body' }))
    ).rejects.toThrow(/claim_path_not_found/);
  });

  it('accepts a path that resolves, on the memory path', async () => {
    const result = await service().submitVerdict(verdict({ claim_path: '$.body' }));
    expect(result.id).toBeTruthy();
  });

  // A path with nothing to anchor it addresses no node in any term, yet it was
  // persisted and grouped into the summary as a distinct finding.
  it('rejects a claim_path supplied without a claim_id', () => {
    const parsed = VerifySubmit.safeParse({
      round_id: '00000000-0000-0000-0000-0000000000a1',
      reporter_id: '00000000-0000-0000-0000-0000000000a2',
      submission_id: '00000000-0000-0000-0000-0000000000a3',
      claim_path: '$.body',
      verdict: 'false',
      client_nonce: 'nonce-unanchored'
    });
    expect(parsed.success).toBe(false);
  });
});

describe('claim_path is canonical before it becomes row identity', () => {
  // parsePath accepts non-canonical aliases. The uniqueness key and the summary
  // group on the raw string, so `$.parts[01]` and `$.parts[1]` would split one
  // logical node into two findings.
  it('normalizes an equivalent path to one spelling', () => {
    const base = {
      round_id: '00000000-0000-0000-0000-0000000000a1',
      reporter_id: '00000000-0000-0000-0000-0000000000a2',
      submission_id: '00000000-0000-0000-0000-0000000000a3',
      claim_id: 'c1',
      verdict: 'false',
      client_nonce: 'nonce-canonical'
    };
    const padded = VerifySubmit.parse({ ...base, claim_path: '$.parts[01]' });
    const plain = VerifySubmit.parse({ ...base, claim_path: '$.parts[1]' });
    expect(padded.claim_path).toBe(plain.claim_path);
    expect(padded.claim_path).toBe('$.parts[1]');
  });
});

describe('the in-memory verdict key survives a colon in claim_id', () => {
  // The key was a colon-joined string and getSummary split on ':', so a claim id
  // like `source:claim` shifted every field after it and produced corrupted
  // rows. Claim ids are author-supplied strings, not identifiers we mint.
  it('groups a colon-bearing claim id correctly', async () => {
    const service = new VerificationService({
      dbRef: { pool: null },
      memVerifications: new Map(),
      memSubmissionIndex: indexWith([{ id: 'source:claim', term: TERM }])
    });

    const roundId = '00000000-0000-0000-0000-0000000000a1';
    await service.submitVerdict(
      verdict({ claim_id: 'source:claim', claim_path: '$', verdict: 'false', client_nonce: 'n1' })
    );
    await service.submitVerdict(
      verdict({
        claim_id: 'source:claim',
        claim_path: '$.body',
        verdict: 'true',
        client_nonce: 'n2'
      })
    );

    const rows = await service.getSummary(roundId);
    expect(rows.map((r) => r.claim_id)).toEqual(['source:claim', 'source:claim']);
    expect(rows.map((r) => r.claim_path).sort()).toEqual(['$', '$.body']);
    expect(rows.find((r) => r.claim_path === '$').false_count).toBe(1);
    expect(rows.find((r) => r.claim_path === '$.body').true_count).toBe(1);
  });
});
