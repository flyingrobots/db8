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
    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict (id) do nothing', [
      roomId,
      'Hardening Room'
    ]);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit') on conflict (id) do nothing",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [participantId, roomId, 'hardened_agent']
    );

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
        client_nonce: 'nonce-m7-dlq-1',
        _force_dlq: true
      });

    expect(res.status).toBe(500);

    // This will fail if pgmq or the queue doesn't exist
    const dlqRes = await pool.query('select * from pgmq.q_db8_dlq');
    expect(dlqRes.rows.length).toBeGreaterThan(0);
  });

  it('Production Rate Limiting: Should throttle rapid RPC calls', async () => {
    // Note: requires ENFORCE_RATELIMIT=1 in environment
    const requests = Array.from({ length: 20 }).map(() =>
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
    // Verify heartbeat table exists
    const tableRes = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'orchestrator_heartbeat'
      );
    `);
    expect(tableRes.rows[0].exists).toBe(true);

    // Verify recovery function exists
    const funcRes = await pool.query(`
      SELECT EXISTS (
        SELECT FROM pg_proc 
        WHERE proname = 'recover_abandoned_barrier'
      );
    `);
    expect(funcRes.rows[0].exists).toBe(true);
  });
});
