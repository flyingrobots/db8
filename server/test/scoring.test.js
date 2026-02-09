import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import pg from 'pg';

describe('Scoring & Reputation (M5)', () => {
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

  const roomId = '90000000-0000-0000-0000-000000000001';
  const roundId = '90000000-0000-0000-0000-000000000002';
  const judgeId = '90000000-0000-0000-0000-000000000003';
  const debaterId = '90000000-0000-0000-0000-000000000004';

  it('POST /rpc/score.submit should record rubric scores', async () => {
    // Seed
    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Scoring Room']);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'published')",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name, role) values ($1, $2, $3, $4)',
      [judgeId, roomId, 'judge_1', 'judge']
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name, role) values ($1, $2, $3, $4)',
      [debaterId, roomId, 'debater_1', 'debater']
    );

    const res = await supertest(app).post('/rpc/score.submit').send({
      round_id: roundId,
      judge_id: judgeId,
      participant_id: debaterId,
      e: 80,
      r: 75,
      c: 90,
      v: 70,
      y: 85,
      client_nonce: 'score-nonce-1'
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /rpc/scores.get should return aggregated scores for a round', async () => {
    const res = await supertest(app).get('/rpc/scores.get').query({ round_id: roundId });

    expect(res.status).toBe(200);
    expect(res.body.rows).toBeDefined();
    // Composite score = weighted average of E/R/C/V/Y
    expect(res.body.rows[0].composite_score).toBeGreaterThan(0);
  });

  it('RPC reputation_update should update Elo deterministically', async () => {
    const opponentId = '90000000-0000-0000-0000-000000000005';
    await pool.query(
      'insert into participants(id, room_id, anon_name, role) values ($1, $2, $3, $4)',
      [opponentId, roomId, 'opponent_1', 'debater']
    );

    // Submit score for opponent too
    await supertest(app).post('/rpc/score.submit').send({
      round_id: roundId,
      judge_id: judgeId,
      participant_id: opponentId,
      e: 50,
      r: 50,
      c: 50,
      v: 50,
      y: 50,
      client_nonce: 'score-nonce-opponent'
    });

    // This is likely a background job or manual RPC trigger for the worker
    const res = await supertest(app).post('/rpc/reputation.update').send({ room_id: roomId });

    expect(res.status).toBe(200);

    const rep = await supertest(app)
      .get('/rpc/reputation.get')
      .query({ participant_id: debaterId });

    expect(rep.body.elo).not.toBe(1200); // Assuming 1200 is starting Elo
  });

  it('GET /rpc/reputation.get with tags should return category elo', async () => {
    // Seed a room with tags in config
    const roomIdTag = '90000000-0000-0000-0000-000000000010';
    await pool.query(
      'insert into rooms(id, title, config) values ($1, $2, \'{"tags": ["science", "tech"]}\')',
      [roomIdTag, 'Tag Room']
    );

    const res = await supertest(app)
      .get('/rpc/reputation.get')
      .query({ participant_id: debaterId, tag: 'science' });

    expect(res.status).toBe(200);
    expect(res.body.tag).toBe('science');
    expect(res.body.elo).toBeDefined();
  });
});
