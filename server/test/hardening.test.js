import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import pg from 'pg';

describe('Hardening & Ops (M7)', () => {
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
    __setDbPool(null);
    await pool.end();
  });

  const roomId = '77770000-0000-0000-0000-000000000001';
  const roundId = '77770000-0000-0000-0000-000000000002';
  const participantId = '77770000-0000-0000-0000-000000000003';

  it('Dead Letter Queue: Failed submissions should be pushed to pgmq', async () => {
    // Clean start for these specific IDs
    await pool.query('delete from participants where id = $1', [participantId]);
    await pool.query('delete from rounds where id = $1', [roundId]);
    await pool.query('delete from rooms where id = $1', [roomId]);

    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Hardening Room']);
    await pool.query("insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit')", [
      roundId,
      roomId
    ]);
    await pool.query('insert into participants(id, room_id, anon_name) values ($1, $2, $3)', [
      participantId,
      roomId,
      'hardened_agent'
    ]);

    const res = await supertest(app)
      .post('/rpc/submission.create')
      .send({
        room_id: roomId,
        round_id: roundId,
        author_id: participantId,
        phase: 'submit',
        deadline_unix: Math.floor(Date.now() / 1000) + 3600,
        content: 'Failing content',
        claims: [{ id: 'c1', text: 'C Argument', support: [{ kind: 'logic', ref: 'r' }] }],
        citations: [{ url: 'https://a.com' }, { url: 'https://b.com' }],
        client_nonce: 'nonce-m7-dlq-cleanup-1',
        _force_dlq: true
      });

    expect(res.status).toBe(500);

    const dlqRes = await pool.query('select * from pgmq.q_db8_dlq');
    expect(dlqRes.rows.length).toBeGreaterThan(0);
  });

  it('Production Rate Limiting: Should throttle rapid RPC calls', async () => {
    // Note: requires ENFORCE_RATELIMIT=1 in environment
    const requests = Array.from({ length: 15 }).map(() =>
      supertest(app).post('/rpc/room.create').send({
        topic: 'Flood Room',
        client_nonce: Math.random().toString()
      })
    );

    const responses = await Promise.all(requests);
    const throttled = responses.filter((r) => r.status === 429);
    expect(throttled.length).toBeGreaterThan(0);
  });

  it('Orchestrator Heartbeat: Recovery infrastructure should exist', async () => {
    const tableRes = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'orchestrator_heartbeat'
      );
    `);
    expect(tableRes.rows[0].exists).toBe(true);

    const funcRes = await pool.query(`
      SELECT EXISTS (
        SELECT FROM pg_proc 
        WHERE proname = 'recover_abandoned_barrier'
      );
    `);
    expect(funcRes.rows[0].exists).toBe(true);
  });

  it('Production Hardening: Should return 503 if DB is missing in production', async () => {
    // Temporarily unset DB pool to simulate outage
    __setDbPool(null);
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const res = await supertest(app)
        .post('/rpc/room.create')
        .send({ topic: 'Production Fail', client_nonce: 'prod-nonce-1' });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('service_unavailable');
    } finally {
      // Restore
      process.env.NODE_ENV = originalEnv;
      __setDbPool(pool);
    }
  });
});
