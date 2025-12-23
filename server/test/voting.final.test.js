import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import pg from 'pg';

describe('Final Voting (M4)', () => {
  let pool;
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';

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

  it('POST /rpc/vote.final submits a vote and is audit-logged', async () => {
    const roomId = '55555555-0000-0000-0000-000000000001';
    const roundId = '55555555-0000-0000-0000-000000000002';
    const participantId = '55555555-0000-0000-0000-000000000003';

    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict (id) do nothing', [
      roomId,
      'Vote Room Unique'
    ]);
    await pool.query(
      'insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, $3) on conflict (id) do nothing',
      [roundId, roomId, 'submit']
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [participantId, roomId, 'voter_unique_final']
    );

    const res = await supertest(app)
      .post('/rpc/vote.final')
      .send({
        round_id: roundId,
        voter_id: participantId,
        approval: true,
        ranking: [participantId],
        client_nonce: 'final-vote-nonce-1'
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Check DB
    const vRes = await pool.query('select * from final_votes where round_id = $1', [roundId]);
    expect(vRes.rows.length).toBe(1);
    expect(vRes.rows[0].approval).toBe(true);

    // Check Audit
    const aRes = await pool.query('select * from admin_audit_log where entity_id = $1', [
      vRes.rows[0].id
    ]);
    expect(aRes.rows.length).toBe(1);
    expect(aRes.rows[0].action).toBe('vote');
  });
});
