import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import app, { __setDbPool } from '../rpc.js';

// The whole feature, driven the way a client meets it: over HTTP, against a
// real database, through the actual routes.
//
// Everything else in this area is tested a layer at a time — the validator, the
// projection, the store contract. None of that proves the pieces are wired to
// each other, and this session shipped two defects that only a run would have
// caught: a route gate that could never fire, and a verifier UI reading a field
// the cutover had removed.
//
// The claim under test is the motivating one from the spec:
//   "the study says remote work reduces productivity"
// The attribution at `$` and the proposition at `$.body` are different findings,
// and a judge must be able to rule on them separately.

const named = (name) => ({ kind: 'named', name });
const PROPOSITION = {
  kind: 'claim',
  subject: named('remote_work'),
  predicate: 'reduces',
  object: 'productivity'
};
const ATTRIBUTED = {
  kind: 'framed',
  frame: { kind: 'attribution', source: named('the_study') },
  body: PROPOSITION
};

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';

// Run against both persistence modes, for the same reason the VerdictStore
// contract suite does: memory is a configured peer, not a lesser path, and a
// flow that only works on one of them is a flow that breaks for half the rooms.
const MODES = [
  { name: 'memory', durable: false, enabled: true },
  { name: 'durable', durable: true, enabled: Boolean(process.env.DB8_TEST_PG) }
];

for (const mode of MODES) {
  const run = mode.enabled ? describe : describe.skip;

  run(`end to end (${mode.name}): a structured claim, and a verdict on one of its nodes`, () => {
    let pool;
    const roomId = '9e2e0000-0000-0000-0000-000000000001';
    const roundId = '9e2e0000-0000-0000-0000-000000000002';
    const authorId = '9e2e0000-0000-0000-0000-000000000003';
    const judgeId = '9e2e0000-0000-0000-0000-000000000004';

    beforeAll(async () => {
      if (!mode.durable) {
        __setDbPool(null);
        return;
      }
      pool = new pg.Pool({ connectionString: dbUrl });
      __setDbPool(pool);

      await pool.query('delete from rooms where id = $1', [roomId]);
      await pool.query('insert into rooms(id, title) values ($1,$2)', [roomId, 'E2E Room']);
      await pool.query(
        `insert into rounds(id, room_id, idx, phase, submit_deadline_unix, published_at_unix)
         values ($1,$2,0,'published',$3,extract(epoch from now())::bigint)`,
        [roundId, roomId, Math.floor(Date.now() / 1000) + 3600]
      );
      await pool.query(
        'insert into participants(id, room_id, anon_name, role) values ($1,$2,$3,$4), ($5,$2,$6,$7)',
        [authorId, roomId, 'e2e_author', 'debater', judgeId, 'e2e_judge', 'judge']
      );
    });

    afterAll(async () => {
      if (!pool) return;
      await pool.query('delete from rooms where id = $1', [roomId]);
      __setDbPool(null);
      await pool.end();
    });

    // Nonces are derived from the test's own name rather than Math.random().
    // Ambient randomness made a failure here unreproducible, and it bought
    // nothing: submission.create is idempotent on (room, round, author, nonce),
    // and beforeAll drops the room, so a stable nonce is safe across reruns and
    // is exactly what the second `npm test` pass exercises (E3, E4).
    const submission = (term, nonce) => ({
      room_id: roomId,
      round_id: roundId,
      author_id: authorId,
      phase: 'submit',
      deadline_unix: Math.floor(Date.now() / 1000) + 3600,
      content: 'The evidence on remote work is contested.',
      claims: [
        { id: 'c1', term, support: [{ kind: 'citation', ref: 'https://example.com/study' }] }
      ],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: `e2e-${mode.name}-${nonce}`
    });

    // Each test that needs a submission makes its own.
    //
    // This used to be a `let submissionId` at describe scope, written by the
    // first test and read by three later ones. That is shared mutable fixture
    // state (E12): the suite only passed in declaration order, and under
    // `--sequence.shuffle.tests` the later tests failed with
    // `submission_id: undefined` because the writer had not run yet (E11).
    const createSubmission = async (nonce, term = ATTRIBUTED) => {
      const res = await request(app)
        .post('/rpc/submission.create')
        .send(submission(term, nonce))
        .expect(200);

      expect(res.body.ok, `submission.create -> ${JSON.stringify(res.body)}`).toBe(true);
      expect(res.body.submission_id, 'submission.create must return an id').toBeTruthy();
      return res.body.submission_id;
    };

    it('accepts a submission carrying a structured claim term', async () => {
      const submissionId = await createSubmission('accepts-structured-term');

      // Not just an id: the stored submission is readable back through the
      // transcript, which is what "accepted" has to mean to a client.
      const res = await request(app).get(`/state?room_id=${roomId}`).expect(200);
      const transcript = res.body.round?.transcript ?? [];
      const mine = transcript.filter((t) => t.submission_id === submissionId);
      expect(
        mine,
        `submission ${submissionId} in a transcript of ${transcript.length} entries`
      ).toHaveLength(1);
    });

    // The gate that was unreachable for the whole of the previous PR. A route
    // that cannot produce its own documented error is not a gate.
    it('rejects a malformed term with the documented error and the offending path', async () => {
      const overDeep = (() => {
        let t = PROPOSITION;
        for (let i = 0; i < 20; i += 1) t = { kind: 'denial', body: t };
        return t;
      })();

      const res = await request(app)
        .post('/rpc/submission.create')
        .send(submission(overDeep, 'malformed-term'))
        .expect(400);

      expect(res.body.error).toBe('invalid_claim_term');
      expect(res.body.details[0]).toMatchObject({ claim_id: 'c1', claim_index: 0 });
      expect(res.body.details[0].message).toMatch(/nesting depth/);
    });

    // Asserted through a helper rather than .expect(200) so a failure reports the
    // server's reason. A bare status assertion told us only "expected 200, got
    // 400" when this flaked, which is not enough to diagnose anything.
    const postVerdict = async (body, expected = 200) => {
      const res = await request(app).post('/rpc/verify.submit').send(body);
      expect(res.status, `verify.submit -> ${res.status}: ${JSON.stringify(res.body)}`).toBe(
        expected
      );
      return res;
    };

    it('rules on the attribution and the proposition as separate findings', async () => {
      const submissionId = await createSubmission('separate-findings');

      await postVerdict({
        round_id: roundId,
        reporter_id: judgeId,
        submission_id: submissionId,
        claim_id: 'c1',
        claim_path: '$',
        verdict: 'false',
        rationale: 'the study does not say that',
        client_nonce: 'e2e-verdict-outer'
      });

      await postVerdict({
        round_id: roundId,
        reporter_id: judgeId,
        submission_id: submissionId,
        claim_id: 'c1',
        claim_path: '$.body',
        verdict: 'true',
        rationale: 'the study says it, and it holds',
        client_nonce: 'e2e-verdict-inner'
      });

      const res = await request(app).get(`/verify/summary?round_id=${roundId}`).expect(200);
      const mine = res.body.rows.filter((r) => r.submission_id === submissionId);

      expect(mine.map((r) => r.claim_path).sort()).toEqual(['$', '$.body']);
      // Opposite verdicts on one claim, which is the entire point: the
      // attribution is false while the proposition it attributes is true.
      expect(mine.find((r) => r.claim_path === '$').false_count).toBe(1);
      expect(mine.find((r) => r.claim_path === '$.body').true_count).toBe(1);
    });

    it('refuses a verdict aimed at a node the claim does not have', async () => {
      const submissionId = await createSubmission('node-not-present');
      const res = await request(app)
        .post('/rpc/verify.submit')
        .send({
          round_id: roundId,
          reporter_id: judgeId,
          submission_id: submissionId,
          claim_id: 'c1',
          claim_path: '$.parts[99].body',
          verdict: 'false',
          rationale: 'nowhere',
          client_nonce: 'e2e-verdict-bogus'
        })
        .expect(400);

      expect(res.body.error).toBe('claim_path_not_found');
    });

    it('refuses a path with no claim to anchor it', async () => {
      const submissionId = await createSubmission('unanchored-path');
      await request(app)
        .post('/rpc/verify.submit')
        .send({
          round_id: roundId,
          reporter_id: judgeId,
          submission_id: submissionId,
          claim_path: '$.body',
          verdict: 'false',
          rationale: 'unanchored',
          client_nonce: 'e2e-verdict-unanchored'
        })
        .expect(400);
    });
  });
}
