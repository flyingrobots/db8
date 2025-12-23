import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import pg from 'pg';

describe('DB-backed RPC integration (Real DB)', () => {
  let pool;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
  });

  afterAll(async () => {
    __setDbPool(null);
    await pool.end();
  });

  it('uses submission_upsert and preserves idempotency on real DB', async () => {
    const roomId = '12120000-0000-0000-0000-000000000001';
    const roundId = '12120000-0000-0000-0000-000000000002';
    const authorId = '12120000-0000-0000-0000-000000000003';

    // Setup real data
    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict (id) do nothing', [
      roomId,
      'Integration Topic'
    ]);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit') on conflict (id) do nothing",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [authorId, roomId, 'integrator']
    );

    const body = {
      room_id: roomId,
      round_id: roundId,
      author_id: authorId,
      phase: 'submit',
      deadline_unix: 0,
      content: 'Real DB content',
      claims: [{ id: 'c1', text: 'Real Claim', support: [{ kind: 'logic', ref: 'a' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'nonce-integration-real-db'
    };

    const first = await request(app).post('/rpc/submission.create').send(body).expect(200);
    const second = await request(app).post('/rpc/submission.create').send(body).expect(200);

    expect(first.body.ok).toBe(true);
    expect(second.body.submission_id).toEqual(first.body.submission_id);
    expect(first.body.note).toBeUndefined(); // Should NOT be a fallback

    // Verify it's actually in the DB
    const check = await pool.query('select * from submissions where id = $1', [
      first.body.submission_id
    ]);
    expect(check.rows.length).toBe(1);
  });

  it('uses vote_submit for continue votes on real DB', async () => {
    const roomId = '12120000-0000-0000-0000-000000000010';
    const roundId = '12120000-0000-0000-0000-000000000011';
    const voterId = '12120000-0000-0000-0000-000000000012';

    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict (id) do nothing', [
      roomId,
      'Vote Topic'
    ]);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'published') on conflict (id) do nothing",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [voterId, roomId, 'voter_real']
    );

    const body = {
      room_id: roomId,
      round_id: roundId,
      voter_id: voterId,
      choice: 'continue',
      client_nonce: 'vote-nonce-real-db'
    };

    const first = await request(app).post('/rpc/vote.continue').send(body).expect(200);
    expect(first.body.ok).toBe(true);

    const check = await pool.query('select * from votes where round_id = $1 and voter_id = $2', [
      roundId,
      voterId
    ]);
    expect(check.rows.length).toBe(1);
  });
});
