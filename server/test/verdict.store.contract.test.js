import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { MemoryVerdictStore } from '../adapters/MemoryVerdictStore.js';
import { PostgresVerdictStore } from '../adapters/PostgresVerdictStore.js';
import { VERDICT_STORE_METHODS } from '../ports/VerdictStore.js';

// One contract, every adapter.
//
// This is the mechanism the codebase was missing. verify_summary grouped by
// claim_path and the in-memory aggregate did not, so the same room reported
// different findings depending on which adapter answered — and no test could
// have caught it, because each adapter was only ever exercised on its own.
//
// A behaviour asserted once and executed N times is the point. Adding an
// adapter means adding a row to `adapters`, not a parallel test file.

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

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';

// The durable adapter needs a server. Without one the memory adapter is still
// held to the contract, and the run says plainly that the other was skipped.
const durableEnabled = Boolean(process.env.DB8_TEST_PG);

let pool;
let seed;

beforeAll(async () => {
  if (!durableEnabled) return;
  pool = new pg.Pool({ connectionString: dbUrl });

  // Fixtures the Postgres adapter needs to satisfy its foreign keys. The memory
  // adapter needs only the submission index, so each adapter's `setup` below
  // returns the ids its own store was primed with.
  const roomId = '7c0a0000-0000-0000-0000-000000000001';
  const roundId = '7c0a0000-0000-0000-0000-000000000002';
  const authorId = '7c0a0000-0000-0000-0000-000000000003';
  const reporterId = '7c0a0000-0000-0000-0000-000000000004';

  await pool.query('delete from rooms where id = $1', [roomId]);
  await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Contract Room']);
  await pool.query(
    "insert into rounds(id, room_id, idx, phase, published_at_unix) values ($1, $2, 0, 'published', extract(epoch from now())::bigint)",
    [roundId, roomId]
  );
  await pool.query(
    'insert into participants(id, room_id, anon_name, role) values ($1,$2,$3,$4), ($5,$2,$6,$7)',
    [authorId, roomId, 'contract_author', 'debater', reporterId, 'contract_judge', 'judge']
  );
  const claims = [{ id: 'c1', term: TERM, support: [{ kind: 'logic', ref: 'x' }] }];
  const sub = await pool.query(
    `insert into submissions (round_id, author_id, content, claims, canonical_sha256, client_nonce)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [roundId, authorId, 'contested', JSON.stringify(claims), 'c'.repeat(64), 'nonce-contract']
  );

  seed = { roomId, roundId, reporterId, submissionId: sub.rows[0].id };
});

afterAll(async () => {
  if (!pool) return;
  await pool.query('delete from rooms where id = $1', [seed.roomId]);
  await pool.end();
});

const adapters = [
  {
    name: 'memory',
    enabled: () => true,
    make: () => {
      const submissionId = 'sub-contract';
      const submissionIndex = new Map([
        [submissionId, { room_id: 'room-1', claims: [{ id: 'c1', term: TERM }] }]
      ]);
      return {
        store: new MemoryVerdictStore({ verdicts: new Map(), submissionIndex }),
        ids: {
          roundId: '00000000-0000-0000-0000-0000000000c1',
          reporterId: '00000000-0000-0000-0000-0000000000c2',
          submissionId
        }
      };
    }
  },
  {
    name: 'postgres',
    enabled: () => durableEnabled,
    make: () => ({
      store: new PostgresVerdictStore({ dbRef: { pool } }),
      ids: {
        roundId: seed.roundId,
        reporterId: seed.reporterId,
        submissionId: seed.submissionId
      }
    })
  }
];

for (const adapter of adapters) {
  const run = adapter.enabled() ? describe : describe.skip;

  run(`VerdictStore contract — ${adapter.name}`, () => {
    let store;
    let ids;
    let nonce = 0;
    const uniqueNonce = () => `contract-${adapter.name}-${(nonce += 1)}`;

    beforeAll(() => {
      const built = adapter.make();
      store = built.store;
      ids = built.ids;
    });

    const verdictInput = (over = {}) => ({
      round_id: ids.roundId,
      reporter_id: ids.reporterId,
      submission_id: ids.submissionId,
      claim_id: 'c1',
      verdict: 'false',
      rationale: 'because',
      client_nonce: uniqueNonce(),
      ...over
    });

    it('presents the whole port surface', () => {
      for (const method of VERDICT_STORE_METHODS) {
        expect(typeof store[method], method).toBe('function');
      }
    });

    it('records a verdict and returns an id', async () => {
      const { id } = await store.submitVerdict(verdictInput());
      expect(id).toBeTruthy();
    });

    it('is idempotent for the same tuple and nonce', async () => {
      const input = verdictInput({ client_nonce: uniqueNonce() });
      const first = await store.submitVerdict(input);
      const second = await store.submitVerdict(input);
      expect(second.id).toBe(first.id);
    });

    it('treats a different claim_path as a different finding', async () => {
      const roundId = ids.roundId;
      await store.submitVerdict(
        verdictInput({ claim_path: '$', verdict: 'false', client_nonce: uniqueNonce() })
      );
      await store.submitVerdict(
        verdictInput({ claim_path: '$.body', verdict: 'true', client_nonce: uniqueNonce() })
      );

      const rows = (await store.summary(roundId)).filter(
        (r) => r.submission_id === ids.submissionId && r.claim_path
      );
      const paths = rows.map((r) => r.claim_path).sort();
      expect(paths).toEqual(['$', '$.body']);

      const outer = rows.find((r) => r.claim_path === '$');
      const inner = rows.find((r) => r.claim_path === '$.body');
      expect(outer.false_count).toBeGreaterThanOrEqual(1);
      expect(inner.true_count).toBeGreaterThanOrEqual(1);
    });

    it('returns summary rows carrying every counted field', async () => {
      await store.submitVerdict(verdictInput({ client_nonce: uniqueNonce() }));
      const [row] = await store.summary(ids.roundId);
      for (const field of [
        'submission_id',
        'claim_id',
        'claim_path',
        'true_count',
        'false_count',
        'unclear_count',
        'needs_work_count',
        'total'
      ]) {
        expect(row, field).toHaveProperty(field);
      }
    });

    it('orders summary rows by submission, claim, then path', async () => {
      const rows = await store.summary(ids.roundId);
      const keys = rows.map((r) => [r.submission_id, r.claim_id || '', r.claim_path || '']);
      const sorted = [...keys].sort(
        (a, b) =>
          String(a[0]).localeCompare(String(b[0])) ||
          a[1].localeCompare(b[1]) ||
          a[2].localeCompare(b[2])
      );
      expect(keys).toEqual(sorted);
    });

    it('returns nothing for a round with no verdicts', async () => {
      expect(await store.summary('00000000-0000-0000-0000-00000000dead')).toEqual([]);
    });

    it('reads back the stored term of a claim', async () => {
      const term = await store.claimTerm(ids.submissionId, 'c1');
      expect(term).toBeTruthy();
      expect(term.kind).toBe('framed');
      expect(term.body.predicate).toBe('reduces');
    });

    it('returns undefined for a claim id the submission does not have', async () => {
      expect(await store.claimTerm(ids.submissionId, 'no-such-claim')).toBeUndefined();
    });
  });
}
