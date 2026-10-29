import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import request from 'supertest';

// #236: a client_nonce names one document. Replaying it with the same document
// returns the same id; reusing it with a different document is refused with
// 409 nonce_reused instead of silently rewriting what the nonce named.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';
const describeDb = process.env.DB8_TEST_PG ? describe : describe.skip;
if (process.env.DB8_TEST_PG) process.env.DATABASE_URL = dbUrl;
const { default: app, __setDbPool } = await import('../rpc.js');

const claims = [
  {
    id: 'c1',
    term: { kind: 'claim', subject: { kind: 'named', name: 'x' }, predicate: 'is', object: 'y' },
    support: [{ kind: 'logic', ref: 'r' }]
  }
];
const citations = [{ url: 'https://example.org/a' }, { url: 'https://example.org/b' }];
const doc = (ids, content, client_nonce) => ({
  ...ids,
  phase: 'submit',
  deadline_unix: 0,
  content,
  claims,
  citations,
  client_nonce
});

describeDb('a reused nonce with a different document (database)', () => {
  let pool;
  const run = crypto.randomUUID().slice(0, 8);
  const ids = {
    room_id: `${run}-0000-4000-8000-000000000001`,
    round_id: `${run}-0000-4000-8000-000000000002`,
    author_id: `${run}-0000-4000-8000-000000000003`
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
    await pool.query('insert into rooms(id, title) values ($1, $2)', [ids.room_id, 'reused']);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, 'submit', 0)",
      [ids.round_id, ids.room_id]
    );
    // Two debaters, one of whom never submits, so early publish (#229) leaves
    // the round in submit while sibling suites sweep.
    await pool.query(
      "insert into participants(id, room_id, anon_name, role) values ($1, $2, 'agent_1', 'debater'), ($3, $2, 'agent_2', 'debater')",
      [ids.author_id, ids.room_id, `${run}-0000-4000-8000-000000000004`]
    );
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [ids.room_id]);
    await pool.end();
  });

  it('is refused with 409 nonce_reused and leaves the stored document as it was', async () => {
    const first = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'First draft: the claim is X.', `reuse-${run}`))
      .expect(200);
    const res = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'Edited after seeing the room: the claim is Y.', `reuse-${run}`))
      .expect(409);
    expect(res.body.error).toBe('nonce_reused');
    const row = await pool.query(
      'select content, canonical_sha256 from submissions where id = $1',
      [first.body.submission_id]
    );
    expect(row.rows).toEqual([
      { content: 'First draft: the claim is X.', canonical_sha256: first.body.canonical_sha256 }
    ]);
  });

  it('a replay of the same document under the same nonce still returns the same id', async () => {
    const body = doc(ids, 'First draft: the claim is X.', `reuse-${run}`);
    const replay = await request(app).post('/rpc/submission.create').send(body).expect(200);
    const row = await pool.query(
      'select id from submissions where round_id = $1 and author_id = $2',
      [ids.round_id, ids.author_id]
    );
    expect(row.rows).toEqual([{ id: replay.body.submission_id }]);
  });
});

describe('a reused nonce with a different document (memory)', () => {
  beforeAll(() => __setDbPool(null));

  it('is refused with 409 nonce_reused', async () => {
    const ids = {
      room_id: crypto.randomUUID(),
      round_id: crypto.randomUUID(),
      author_id: crypto.randomUUID()
    };
    const first = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'A', 'mem-reuse-1'))
      .expect(200);
    const res = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'B', 'mem-reuse-1'))
      .expect(409);
    expect(res.body.error).toBe('nonce_reused');
    const replay = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'A', 'mem-reuse-1'))
      .expect(200);
    expect(replay.body.submission_id).toBe(first.body.submission_id);
  });
});
