import { describe, it, expect } from 'vitest';
import { VerifySubmit } from '../schemas.js';
import { atPath, parsePath, formatPath } from '../claims/paths.js';

// The reason structured claims exist. A verdict must be able to say *which
// layer* it rules on.
//
// "My opponent's cited study claims remote work reduces productivity" marked
// `false` is ambiguous between "the study does not say that" (the attribution
// is wrong) and "the study says it and is wrong" (the proposition is wrong).
// Those are different findings with different consequences for scoring and
// Elo, and a verdict keyed only to a claim id cannot distinguish them.

const named = (name) => ({ kind: 'named', name });
const proposition = {
  kind: 'claim',
  subject: named('remote_work'),
  predicate: 'reduces',
  object: 'productivity'
};
const attributed = {
  kind: 'framed',
  frame: { kind: 'attribution', source: named('the_study') },
  body: proposition
};

const verdict = (over) => ({
  round_id: '00000000-0000-0000-0000-000000000002',
  reporter_id: '00000000-0000-0000-0000-000000000003',
  submission_id: '00000000-0000-0000-0000-000000000004',
  verdict: 'false',
  client_nonce: 'nonce-verdict-path-1',
  ...over
});

describe('verdicts target a claim path', () => {
  it('accepts a verdict with no path, ruling on the claim as a whole', () => {
    const r = VerifySubmit.safeParse(verdict({ claim_id: 'c1' }));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts a path naming the attribution', () => {
    const r = VerifySubmit.safeParse(verdict({ claim_id: 'c1', claim_path: '$' }));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts a path naming the inner proposition', () => {
    const r = VerifySubmit.safeParse(verdict({ claim_id: 'c1', claim_path: '$.body' }));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('rejects a syntactically invalid path', () => {
    for (const bad of ['body', '$..body', '$.body[', 'parts[0]']) {
      const r = VerifySubmit.safeParse(verdict({ claim_id: 'c1', claim_path: bad }));
      expect(r.success, `${bad} should be rejected`).toBe(false);
    }
  });

  it('distinguishes the two readings that previously collided', () => {
    // The whole point: these are different rows, not the same verdict twice.
    const onAttribution = VerifySubmit.parse(verdict({ claim_id: 'c1', claim_path: '$' }));
    const onProposition = VerifySubmit.parse(verdict({ claim_id: 'c1', claim_path: '$.body' }));
    expect(onAttribution.claim_path).not.toBe(onProposition.claim_path);

    // And each resolves to a genuinely different node of the term.
    expect(atPath(attributed, parsePath(onAttribution.claim_path)).kind).toBe('framed');
    expect(atPath(attributed, parsePath(onProposition.claim_path)).kind).toBe('claim');
  });

  it('round-trips a path through parse and format', () => {
    for (const p of ['$', '$.body', '$.parts[1].body', '$.when', '$.still']) {
      expect(formatPath(parsePath(p))).toBe(p);
    }
  });
});

// The memory fallback is a second implementation of the same aggregate, so it
// drifts unless pinned. If it groups without claim_path while the SQL groups
// with it, the same room reports different findings depending on whether the
// database happened to be reachable.
describe('the memory summary separates paths the same way the SQL does', () => {
  it('reports one row per claim_path', async () => {
    const { VerificationService } = await import('../services/VerificationService.js');
    const { createVerdictStore } = await import('../adapters/ConfiguredVerdictStore.js');
    const roundId = '00000000-0000-0000-0000-0000000000aa';
    const service = new VerificationService({
      store: createVerdictStore({
        dbRef: { pool: null },
        verdicts: new Map(),
        submissionIndex: new Map([
          ['sub-1', { room_id: 'room-1', claims: [{ id: 'c1', term: attributed }] }]
        ])
      })
    });

    const base = {
      round_id: roundId,
      reporter_id: 'judge-1',
      submission_id: 'sub-1',
      claim_id: 'c1'
    };
    await service.submitVerdict({ ...base, claim_path: '$', verdict: 'false', client_nonce: 'n1' });
    await service.submitVerdict({
      ...base,
      claim_path: '$.body',
      verdict: 'true',
      client_nonce: 'n2'
    });

    const rows = await service.getSummary(roundId);
    expect(rows.map((r) => r.claim_path).sort()).toEqual(['$', '$.body']);
    expect(rows.find((r) => r.claim_path === '$').false_count).toBe(1);
    expect(rows.find((r) => r.claim_path === '$.body').true_count).toBe(1);
  });
});
