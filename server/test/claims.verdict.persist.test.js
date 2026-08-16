import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// The payoff, at the storage layer. Two verdicts on different nodes of the same
// claim must be two rows. If the uniqueness key ignores claim_path, the second
// silently overwrites the first and "the source does not say that" is lost the
// moment someone also rules on the proposition.

// The claim carries a real term, because a verdict's path is checked against
// it: "the study says remote work reduces productivity" has an addressable
// attribution at `$` and the proposition it attributes at `$.body`.
const CLAIMS = [
  {
    id: 'c1',
    term: {
      kind: 'framed',
      frame: { kind: 'attribution', source: { kind: 'named', name: 'the_study' } },
      body: {
        kind: 'claim',
        subject: { kind: 'named', name: 'remote_work' },
        predicate: 'reduces',
        object: 'productivity'
      }
    },
    support: [{ kind: 'citation', ref: 'https://example.com/study' }]
  }
];

describe('verdict claim_path persistence', () => {
  let pool;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  const roomId = '5c1a0000-0000-0000-0000-000000000001';
  const roundId = '5c1a0000-0000-0000-0000-000000000002';
  const authorId = '5c1a0000-0000-0000-0000-000000000003';
  const judgeId = '5c1a0000-0000-0000-0000-000000000004';

  // Every test makes its own submission and scopes its assertions to it.
  //
  // There used to be a single `let submissionId` filled in beforeAll, and every
  // test wrote verdicts against that one row. The counts then depended on
  // declaration order: "stores verdicts on different paths as separate rows"
  // asserted exactly 2 rows, while four later tests added more to the same
  // submission. Under `--sequence.shuffle.tests` it failed with `got 3` and
  // `got 4`, and the summary test saw a stray null-path row (E11, E12).
  const createSubmission = async (nonce) => {
    const sub = await pool.query(
      `insert into submissions (round_id, author_id, content, claims, canonical_sha256, client_nonce)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (round_id, author_id, client_nonce) do update set content = excluded.content
       returning id`,
      [roundId, authorId, 'contested', JSON.stringify(CLAIMS), 'b'.repeat(64), nonce]
    );
    expect(sub.rows[0]?.id, `submission insert for nonce ${nonce}`).toBeTruthy();
    return sub.rows[0].id;
  };

  const writeVerdict = (submissionId, verdict, rationale, nonce, claimPath) =>
    pool.query('select verify_submit($1,$2,$3,$4,$5,$6,$7,$8)', [
      roundId,
      judgeId,
      submissionId,
      'c1',
      verdict,
      rationale,
      nonce,
      claimPath
    ]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Verdict Path Room']);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, published_at_unix) values ($1, $2, 0, 'published', extract(epoch from now())::bigint)",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name, role) values ($1, $2, $3, $4), ($5, $2, $6, $7)',
      [authorId, roomId, 'path_author', 'debater', judgeId, 'path_judge', 'judge']
    );
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.end();
  });

  it('stores verdicts on different paths as separate rows', async () => {
    const submissionId = await createSubmission('nonce-sub-separate-rows');
    await writeVerdict(submissionId, 'false', 'the study does not say that', 'outer', '$');
    await writeVerdict(submissionId, 'true', 'the study says it, and it holds', 'inner', '$.body');

    const rows = await pool.query(
      'select claim_path, verdict from verification_verdicts where submission_id = $1 order by claim_path',
      [submissionId]
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((r) => r.claim_path)).toEqual(['$', '$.body']);
    // Opposite verdicts on the same claim, which is the entire point: the
    // attribution is false while the proposition it attributes is true.
    expect(rows.rows.map((r) => r.verdict)).toEqual(['false', 'true']);
  });

  // Storage separating the two findings is worth nothing if the read layer
  // merges them again. verify_summary is the scoring aggregate, and scoring is
  // the stated reason claim paths exist: "the study does not say that" and "the
  // study says it and it is false" must not land in the same false_count.
  it('reports the two paths as separate rows in the summary', async () => {
    const submissionId = await createSubmission('nonce-sub-summary');
    await writeVerdict(submissionId, 'false', 'the study does not say that', 'outer', '$');
    await writeVerdict(submissionId, 'true', 'the study says it, and it holds', 'inner', '$.body');

    const summary = await pool.query('select * from verify_summary($1::uuid)', [roundId]);
    const mine = summary.rows.filter((r) => r.submission_id === submissionId);

    expect(mine.map((r) => r.claim_path).sort()).toEqual(['$', '$.body']);

    const outer = mine.find((r) => r.claim_path === '$');
    const inner = mine.find((r) => r.claim_path === '$.body');
    expect(outer.false_count).toBe(1);
    expect(outer.true_count).toBe(0);
    expect(inner.true_count).toBe(1);
    expect(inner.false_count).toBe(0);
  });

  // A path that parses is not a path that exists. Binding a verdict to a node
  // is the whole point of the column, so a path naming no node in that claim's
  // term is not a verdict on anything.
  //
  // Enforced in VerificationService, not in verify_submit: server/claims/paths.js
  // owns the path grammar, and a plpgsql reimplementation would be a second copy
  // to drift. The trade is that a client reaching the function directly is not
  // stopped — revisit if the SQL-only direction lands.
  it('refuses a verdict whose path names no node in the claim term', async () => {
    const submissionId = await createSubmission('nonce-sub-bogus-path');
    const { VerificationService } = await import('../services/VerificationService.js');
    const { createVerdictStore } = await import('../adapters/ConfiguredVerdictStore.js');
    const service = new VerificationService({
      store: createVerdictStore({
        dbRef: { pool },
        verdicts: new Map(),
        submissionIndex: new Map()
      })
    });

    await expect(
      service.submitVerdict({
        round_id: roundId,
        reporter_id: judgeId,
        submission_id: submissionId,
        claim_id: 'c1',
        claim_path: '$.parts[99].body',
        verdict: 'false',
        rationale: 'targets a node that does not exist',
        client_nonce: 'nonce-path-bogus'
      })
    ).rejects.toThrow(/claim_path_not_found/);
  });

  it('accepts a path that does resolve against the stored term', async () => {
    const submissionId = await createSubmission('nonce-sub-resolves');
    const { VerificationService } = await import('../services/VerificationService.js');
    const { createVerdictStore } = await import('../adapters/ConfiguredVerdictStore.js');
    const service = new VerificationService({
      store: createVerdictStore({
        dbRef: { pool },
        verdicts: new Map(),
        submissionIndex: new Map()
      })
    });

    const result = await service.submitVerdict({
      round_id: roundId,
      reporter_id: judgeId,
      submission_id: submissionId,
      claim_id: 'c1',
      claim_path: '$.body',
      verdict: 'true',
      rationale: 'resolves',
      client_nonce: 'nonce-path-resolves'
    });
    expect(result.id).toBeTruthy();

    // A returned id is the service's claim, not evidence. Read the row back:
    // "accepts" has to mean the verdict is durable and bound to the node named.
    const rows = await pool.query(
      'select claim_path, verdict from verification_verdicts where id = $1',
      [result.id]
    );
    expect(rows.rows, `verdict ${result.id} must be stored`).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ claim_path: '$.body', verdict: 'true' });
  });

  it('is still idempotent for the same path and nonce', async () => {
    const submissionId = await createSubmission('nonce-sub-idempotent');
    await writeVerdict(submissionId, 'false', 'first ruling', 'outer', '$');

    const before = await pool.query(
      'select count(*)::int as n from verification_verdicts where submission_id = $1',
      [submissionId]
    );
    expect(before.rows[0].n, 'one verdict before the resubmission').toBe(1);

    await writeVerdict(submissionId, 'unclear', 'revised', 'outer', '$');
    const after = await pool.query(
      'select count(*)::int as n, max(verdict) filter (where claim_path = $2) as v from verification_verdicts where submission_id = $1',
      [submissionId, '$']
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(after.rows[0].v).toBe('unclear');
  });

  it('treats a whole-claim verdict as distinct from one naming a path', async () => {
    const submissionId = await createSubmission('nonce-sub-null-path');
    await writeVerdict(submissionId, 'false', 'on the attribution', 'outer', '$');
    await writeVerdict(submissionId, 'needs_work', 'no path given', 'null-path', null);

    const rows = await pool.query(
      'select count(*)::int as n from verification_verdicts where submission_id = $1 and claim_path is null',
      [submissionId]
    );
    expect(rows.rows[0].n).toBe(1);
  });
});
