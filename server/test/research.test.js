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

  const roomId = '66660000-0000-0000-0000-000000000001';
  const roundId = '66660000-0000-0000-0000-000000000002';
  const participantId = '66660000-0000-0000-0000-000000000003';
  const limitedRoom = '66660000-0000-0000-0000-000000000010';
  const limitedRound = '66660000-0000-0000-0000-000000000011';
  const urls = ['https://example.com/evidence', 'https://a.com', 'https://b.com'];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
    // research_cache is global (keyed by url_hash) and research_usage accumulates
    // per round, so neither resets between runs. Left alone, the first fetch below
    // reports cached=true on a second run, and the quota round starts already spent
    // — which made the quota test pass vacuously rather than by exercising the
    // limit. Clear both before the suite, not between tests: the cache-retrieval
    // test deliberately reads what the first test wrote.
    await pool.query('delete from research_cache where url = any($1)', [urls]);
    await pool.query('delete from research_usage where room_id = any($1)', [[roomId, limitedRoom]]);
  });

  afterAll(async () => {
    await pool.query('delete from research_cache where url = any($1)', [urls]);
    await pool.query('delete from research_usage where room_id = any($1)', [[roomId, limitedRoom]]);
    await pool.end();
  });

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

    // First fetch must succeed, or the 429 below proves nothing: a round whose
    // quota was already spent by an earlier run would reject both calls and the
    // assertion would pass without the limit ever being exercised.
    const first = await supertest(app).post('/rpc/research.fetch').send({
      room_id: limitedRoom,
      round_id: limitedRound,
      participant_id: participantId,
      url: 'https://a.com'
    });
    expect(first.status).toBe(200);

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
