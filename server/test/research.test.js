import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import pg from 'pg';

describe('Research Tools & Cache (M6)', () => {
  let pool;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  const roomId = '66660000-0000-0000-0000-000000000001';
  const roundId = '66660000-0000-0000-0000-000000000002';
  const participantId = '66660000-0000-0000-0000-000000000003';

  it('POST /rpc/research.fetch should snapshot content and cache it', async () => {
    await pool.query(
      'insert into rooms(id, title, config) values ($1, $2, $3) on conflict (id) do nothing',
      [roomId, 'Research Room', JSON.stringify({ max_fetches_per_round: 5 })]
    );
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit') on conflict (id) do nothing",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [participantId, roomId, 'researcher_1']
    );

    const res = await supertest(app).post('/rpc/research.fetch').send({
      room_id: roomId,
      round_id: roundId,
      participant_id: participantId,
      url: 'https://example.com/evidence'
    });

    expect(res.status).toBe(200);
    expect(res.body.snapshot.title).toBeDefined();
    expect(res.body.cached).toBe(false);

    // Second call should be cached
    const res2 = await supertest(app).post('/rpc/research.fetch').send({
      room_id: roomId,
      round_id: roundId,
      participant_id: participantId,
      url: 'https://example.com/evidence'
    });
    expect(res2.body.cached).toBe(true);
  });

  it('POST /rpc/research.fetch should enforce per-round quotas', async () => {
    const limitedRoom = '66660000-0000-0000-0000-000000000010';
    const limitedRound = '66660000-0000-0000-0000-000000000011';

    await pool.query(
      'insert into rooms(id, title, config) values ($1, $2, $3) on conflict (id) do nothing',
      [limitedRoom, 'Quota Room', JSON.stringify({ max_fetches_per_round: 1 })]
    );
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit') on conflict (id) do nothing",
      [limitedRound, limitedRoom]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [participantId, limitedRoom, 'researcher_quota']
    );

    // First fetch
    await supertest(app)
      .post('/rpc/research.fetch')
      .send({
        room_id: limitedRoom,
        round_id: limitedRound,
        participant_id: participantId,
        url: 'https://a.com'
      });

    // Second fetch (new URL) should fail
    const res = await supertest(app).post('/rpc/research.fetch').send({
      room_id: limitedRoom,
      round_id: limitedRound,
      participant_id: participantId,
      url: 'https://b.com'
    });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('quota_exceeded');
  });

  it('GET /rpc/research.cache should retrieve cached entries', async () => {
    const res = await supertest(app)
      .get('/rpc/research.cache')
      .query({ url: 'https://example.com/evidence' });

    expect(res.status).toBe(200);
    expect(res.body.snapshot).toBeDefined();
  });
});
