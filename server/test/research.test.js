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
    await pool.query(
      'truncate rooms, participants, rounds, submissions, votes, final_votes, admin_audit_log cascade'
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  const roomId = '66660000-0000-0000-0000-000000000001';
  const roundId = '66660000-0000-0000-0000-000000000002';
  const participantId = '66660000-0000-0000-0000-000000000003';

  it('POST /rpc/research.fetch should snapshot content and cache it', async () => {
    // Seed
    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Research Room']);
    await pool.query("insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit')", [
      roundId,
      roomId
    ]);
    await pool.query('insert into participants(id, room_id, anon_name) values ($1, $2, $3)', [
      participantId,
      roomId,
      'researcher_1'
    ]);

    const targetUrl = 'https://example.com/article';
    const res = await supertest(app).post('/rpc/research.fetch').send({
      room_id: roomId,
      round_id: roundId,
      participant_id: participantId,
      url: targetUrl
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.snapshot).toBeDefined();
    expect(res.body.snapshot.title).toBeDefined();
    expect(res.body.url_hash).toBeDefined();

    // Verify it was cached in DB
    const cacheRes = await pool.query('select * from research_cache where url = $1', [targetUrl]);
    expect(cacheRes.rows.length).toBe(1);
  });

  it('POST /rpc/research.fetch should enforce per-round quotas', async () => {
    // Set a small quota on the room
    await pool.query(
      'update rooms set config = config || \'{"max_fetches_per_round": 1}\' where id = $1',
      [roomId]
    );

    const res = await supertest(app).post('/rpc/research.fetch').send({
      room_id: roomId,
      round_id: roundId,
      participant_id: participantId,
      url: 'https://example.com/another-article'
    });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('quota_exceeded');
  });

  it('GET /rpc/research.cache should retrieve cached entries', async () => {
    const res = await supertest(app)
      .get('/rpc/research.cache')
      .query({ url: 'https://example.com/article' });

    expect(res.status).toBe(200);
    expect(res.body.snapshot).toBeDefined();
  });
});
