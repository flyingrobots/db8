import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import request from 'supertest';

// #244: a room created with cfg.predicates declares its predicate vocabulary.
// #200 stored it, but submission.create validated claim terms with no options,
// so the vocabulary was stored and never enforced.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';
const describeDb = process.env.DB8_TEST_PG ? describe : describe.skip;
if (process.env.DB8_TEST_PG) process.env.DATABASE_URL = dbUrl;
const { default: app, __setDbPool } = await import('../rpc.js');

const claimWith = (predicate) => [
  {
    id: 'c1',
    term: {
      kind: 'claim',
      subject: { kind: 'named', name: 'tariffs' },
      predicate,
      object: 'imports'
    },
    support: [{ kind: 'logic', ref: 'r' }]
  }
];
const citations = [{ url: 'https://example.org/a' }, { url: 'https://example.org/b' }];
const doc = (ids, predicate) => ({
  ...ids,
  phase: 'submit',
  deadline_unix: 0,
  content: `Tariffs ${predicate} imports.`,
  claims: claimWith(predicate),
  citations,
  client_nonce: `pred-${crypto.randomUUID()}`
});
const submit = (body) => request(app).post('/rpc/submission.create').send(body);

function expectUndeclared(res, predicate) {
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_claim_term');
  expect(res.body.details).toEqual([
    expect.objectContaining({
      claim_id: 'c1',
      claim_index: 0,
      path: '$',
      message: expect.stringContaining(`"${predicate}"`)
    })
  ]);
}

describe('a declared predicate vocabulary is enforced (memory)', () => {
  beforeAll(() => __setDbPool(null));

  async function room(cfg) {
    const created = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Vocabulary', cfg, client_nonce: `pred-room-${crypto.randomUUID()}` })
      .expect(200);
    const room_id = created.body.room_id;
    const seats = await request(app).get(`/rpc/room.get?room_id=${room_id}`).expect(200);
    const state = await request(app).get(`/state?room_id=${room_id}`).expect(200);
    return {
      room_id,
      round_id: state.body.round.round_id,
      author_id: seats.body.participants[0].id
    };
  }

  it('rejects a predicate outside the vocabulary and names it', async () => {
    const ids = await room({ participant_count: 2, predicates: ['reduces'] });
    expectUndeclared(await submit(doc(ids, 'causes')), 'causes');
  });

  it('accepts a predicate inside the vocabulary', async () => {
    const ids = await room({ participant_count: 2, predicates: ['reduces'] });
    expect((await submit(doc(ids, 'reduces'))).status).toBe(200);
  });

  it('a room without predicates accepts any snake_case predicate', async () => {
    const ids = await room({ participant_count: 2 });
    expect((await submit(doc(ids, 'causes'))).status).toBe(200);
  });
});

describeDb('a declared predicate vocabulary is enforced (database)', () => {
  let pool;
  const run = crypto.randomUUID().slice(0, 8);
  const id = (n) => `${run}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const strict = { room_id: id(1), round_id: id(2), author_id: id(3) };
  const open = { room_id: id(11), round_id: id(12), author_id: id(13) };

  async function seed(ids, config) {
    await pool.query('insert into rooms(id, title, config) values ($1, $2, $3)', [
      ids.room_id,
      'vocabulary',
      JSON.stringify(config)
    ]);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, 'submit', 0)",
      [ids.round_id, ids.room_id]
    );
    // A second debater who never submits, so early publish (#229) leaves the
    // round in submit while sibling suites sweep.
    await pool.query(
      "insert into participants(id, room_id, anon_name, role) values ($1, $2, 'agent_1', 'debater'), (gen_random_uuid(), $2, 'agent_2', 'debater')",
      [ids.author_id, ids.room_id]
    );
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
    await seed(strict, { predicates: ['reduces'] });
    await seed(open, {});
  });

  afterAll(async () => {
    for (const r of [strict.room_id, open.room_id])
      await pool.query('delete from rooms where id = $1', [r]);
    __setDbPool(null);
    await pool.end();
  });

  it('rejects a predicate outside the vocabulary, names it, and stores nothing', async () => {
    expectUndeclared(await submit(doc(strict, 'causes')), 'causes');
    const rows = await pool.query('select 1 from submissions where round_id = $1', [
      strict.round_id
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('accepts a predicate inside the vocabulary', async () => {
    const res = await submit(doc(strict, 'reduces'));
    expect(res.status).toBe(200);
    expect(res.body.note).toBeUndefined();
  });

  it("uses the round's room, not the room_id the request names", async () => {
    expectUndeclared(await submit(doc({ ...strict, room_id: open.room_id }, 'causes')), 'causes');
  });

  it('a room without predicates accepts any snake_case predicate', async () => {
    expect((await submit(doc(open, 'causes'))).status).toBe(200);
  });
});
