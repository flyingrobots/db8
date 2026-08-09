import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import pg from 'pg';

describe('Final Voting (M4)', () => {
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

  it('POST /rpc/vote.final submits a vote and is audit-logged', async () => {
    const roomId = '55560000-0000-0000-0000-000000000001';
    const roundId = '55560000-0000-0000-0000-000000000002';
    const participantId = '55560000-0000-0000-0000-000000000003';

    await pool.query('delete from final_votes where round_id = $1', [roundId]);
    await pool.query('delete from participants where id = $1', [participantId]);
    await pool.query('delete from rounds where id = $1', [roundId]);
    await pool.query('delete from rooms where id = $1', [roomId]);

    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Vote Room Unique']);
    await pool.query("insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit')", [
      roundId,
      roomId
    ]);
    await pool.query('insert into participants(id, room_id, anon_name) values ($1, $2, $3)', [
      participantId,
      roomId,
      'voter_unique_final'
    ]);

    // Set round to final phase so vote is allowed
    await pool.query("update rounds set phase = 'final' where id = $1", [roundId]);

    const res = await supertest(app).post('/rpc/vote.final').send({
      round_id: roundId,
      voter_id: participantId,
      approval: true,
      ranking: [],
      client_nonce: 'vote-final-nonce-unique-1'
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify audit log
    const audit = await pool.query(
      'select * from admin_audit_log where entity_type = $1 and actor_id = $2',
      ['vote', participantId]
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });
});
