import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import pg from 'pg';

describe('research fetching, caching, and per-round quotas', () => {
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
  // A room of its own for the read-back test, so it fetches what it later reads
  // instead of depending on another test having populated the cache.
  const cacheRoom = '66660000-0000-0000-0000-000000000020';
  const cacheRound = '66660000-0000-0000-0000-000000000021';

  const EVIDENCE_URL = 'https://example.com/evidence';
  const CACHE_URL = 'https://example.com/cache-readback';
  const urls = [EVIDENCE_URL, CACHE_URL, 'https://a.com', 'https://b.com'];
  const rooms = [roomId, limitedRoom, cacheRoom];

  const seedRoom = async (room, round, anonName, cfg) => {
    await pool.query(
      'insert into rooms(id, title, config) values ($1, $2, $3) on conflict (id) do nothing',
      [room, 'Research Room', JSON.stringify(cfg)]
    );
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit') on conflict (id) do nothing",
      [round, room]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [participantId, room, anonName]
    );
  };

  const fetchUrl = (room, round, url) =>
    supertest(app)
      .post('/rpc/research.fetch')
      .send({ room_id: room, round_id: round, participant_id: participantId, url });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
    // research_cache is global (keyed by url_hash) and research_usage accumulates
    // per round, so neither resets between runs. Left alone, the first fetch below
    // reports cached=true on a second run, and the quota round starts already spent
    // — which made the quota test pass vacuously rather than by exercising the
    // limit. Cleared before the suite; each test now arranges whatever cache
    // state it asserts on, so none of them reads another's residue (E11).
    await pool.query('delete from research_cache where url = any($1)', [urls]);
    await pool.query('delete from research_usage where room_id = any($1)', [rooms]);
  });

  afterAll(async () => {
    await pool.query('delete from research_cache where url = any($1)', [urls]);
    await pool.query('delete from research_usage where room_id = any($1)', [rooms]);
    await pool.end();
  });

  it('serves the second fetch of a url from cache, with the same snapshot', async () => {
    await seedRoom(roomId, roundId, 'researcher_1', { max_fetches_per_round: 5 });

    const res = await fetchUrl(roomId, roundId, EVIDENCE_URL);
    expect(res.status, `research.fetch -> ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.cached, 'first fetch of a fresh url is not cached').toBe(false);

    const res2 = await fetchUrl(roomId, roundId, EVIDENCE_URL);
    expect(res2.status).toBe(200);
    expect(res2.body.cached, 'second fetch of the same url is cached').toBe(true);

    // The point of a cache is that it returns the same thing, so compare the
    // snapshots rather than checking a field merely exists.
    expect(res2.body.snapshot).toEqual(res.body.snapshot);
  });

  it('refuses a fetch once the round quota is spent', async () => {
    await seedRoom(limitedRoom, limitedRound, 'researcher_quota', { max_fetches_per_round: 1 });

    // First fetch must succeed, or the 429 below proves nothing: a round whose
    // quota was already spent by an earlier run would reject both calls and the
    // assertion would pass without the limit ever being exercised.
    const first = await fetchUrl(limitedRoom, limitedRound, 'https://a.com');
    expect(first.status, 'the first fetch must be inside the quota').toBe(200);

    const res = await fetchUrl(limitedRoom, limitedRound, 'https://b.com');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('quota_exceeded');
  });

  it('returns through the cache endpoint exactly what the fetch stored', async () => {
    await seedRoom(cacheRoom, cacheRound, 'researcher_cache', { max_fetches_per_round: 5 });

    // Arranged here rather than inherited from the first test, which is what
    // made this order-dependent: run first, it found an empty cache.
    const stored = await fetchUrl(cacheRoom, cacheRound, CACHE_URL);
    expect(stored.status, `research.fetch -> ${JSON.stringify(stored.body)}`).toBe(200);

    const res = await supertest(app).get('/rpc/research.cache').query({ url: CACHE_URL });

    expect(res.status).toBe(200);
    expect(res.body.snapshot, 'the cache must return the snapshot the fetch stored').toEqual(
      stored.body.snapshot
    );
  });
});
