import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';

// #200: room_create read p_cfg for participant_count and submit_minutes but
// never wrote it, so every room's config was '{}' and everything that reads
// rooms.config (research quotas, attribution_mode, predicate vocabularies) was
// inert. The config a room is created with is now stored, in both modes.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';
const describeDb = process.env.DB8_TEST_PG ? describe : describe.skip;
const nonce = () => `cfg-${crypto.randomUUID()}`;

const cfg = {
  participant_count: 3,
  submit_minutes: 2,
  max_fetches_per_round: 1,
  attribution_mode: 'masked',
  predicates: ['reduces', 'causes']
};

describe('room.create validates the config it stores', () => {
  it.each([
    [{ attribution_mode: 'secret' }, 'attribution_mode'],
    [{ predicates: ['Not Snake'] }, 'predicates'],
    [{ max_fetches_per_round: -1 }, 'max_fetches_per_round']
  ])('rejects %j', async (bad, field) => {
    const res = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Bad config', cfg: bad, client_nonce: nonce() })
      .expect(400);
    expect(res.body.error).toMatch(field);
  });
});

describe('room.create stores its config (memory)', () => {
  beforeAll(() => __setDbPool(null));

  it('room.get returns the config the room was created with', async () => {
    const created = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Configured in memory', cfg, client_nonce: nonce() })
      .expect(200);
    const got = await request(app).get(`/rpc/room.get?room_id=${created.body.room_id}`).expect(200);
    expect(got.body.config).toEqual(cfg);
    expect(got.body.participants).toHaveLength(3);
  });
});

describeDb('room.create stores its config (database)', () => {
  let pool;
  const created = [];

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
  });

  afterAll(async () => {
    for (const id of created) await pool.query('delete from rooms where id = $1', [id]);
    await pool.end();
  });

  async function create(body) {
    const res = await request(app).post('/rpc/room.create').send(body).expect(200);
    expect(res.body.note).toBeUndefined();
    created.push(res.body.room_id);
    return res.body.room_id;
  }

  it('writes rooms.config and room.get returns it', async () => {
    const id = await create({ topic: 'Configured in Postgres', cfg, client_nonce: nonce() });
    const row = await pool.query('select config from rooms where id = $1', [id]);
    expect(row.rows[0].config).toEqual(cfg);
    const got = await request(app).get(`/rpc/room.get?room_id=${id}`).expect(200);
    expect(got.body.config).toEqual(cfg);
  });

  it('a replayed nonce keeps the config of the first creation', async () => {
    const n = nonce();
    const id = await create({ topic: 'First', cfg: { participant_count: 2 }, client_nonce: n });
    const again = await create({
      topic: 'Second',
      cfg: { participant_count: 2, max_fetches_per_round: 9 },
      client_nonce: n
    });
    expect(again).toBe(id);
    const row = await pool.query('select config from rooms where id = $1', [id]);
    expect(row.rows[0].config).toEqual({ participant_count: 2 });
  });

  it('a stored research quota is enforced', async () => {
    const id = await create({
      topic: 'Quota from config',
      cfg: { participant_count: 2, max_fetches_per_round: 1 },
      client_nonce: nonce()
    });
    const round = (await pool.query('select id from rounds where room_id = $1', [id])).rows[0].id;
    const participant = (
      await pool.query('select id from participants where room_id = $1 limit 1', [id])
    ).rows[0].id;
    const fetchOnce = (n) =>
      request(app)
        .post('/rpc/research.fetch')
        .send({
          room_id: id,
          round_id: round,
          participant_id: participant,
          url: `https://example.org/cfg-${n}-${id}`
        });
    expect((await fetchOnce(1)).status).toBe(200);
    const second = await fetchOnce(2);
    expect(second.status).toBe(429);
    expect(second.body.error).toBe('quota_exceeded');
  });
});
