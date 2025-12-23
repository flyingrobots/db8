import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { __setDbPool } from '../rpc.js';

describe('Room Lifecycle (M4)', () => {
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

  it('round_open_next should close the room when a round transitions to final', async () => {
    const roomId = '70000000-0000-0000-0000-000000000001';
    const roundId = '70000000-0000-0000-0000-000000000002';
    const participantId = '70000000-0000-0000-0000-000000000003';

    await pool.query('insert into rooms(id, title, status) values ($1, $2, $3)', [
      roomId,
      'Lifecycle Room',
      'active'
    ]);
    // Round is published and vote window closed
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, continue_vote_close_unix) values ($1, $2, 0, 'published', 100)",
      [roundId, roomId]
    );
    await pool.query('insert into participants(id, room_id, anon_name) values ($1, $2, $3)', [
      participantId,
      roomId,
      'voter_1'
    ]);

    // Tally is No (or equal), so it should transition to final
    await pool.query(
      "insert into votes(round_id, voter_id, kind, ballot, client_nonce) values ($1, $2, 'continue', '{\"choice\": \"end\"}', 'nonce-1')",
      [roundId, participantId]
    );

    // Run watcher flip
    await pool.query('select round_open_next()');

    // Check room status
    const roomRes = await pool.query('select status from rooms where id = $1', [roomId]);
    expect(roomRes.rows[0].status).toBe('closed');

    // Check round phase
    const roundRes = await pool.query('select phase from rounds where id = $1', [roundId]);
    expect(roundRes.rows[0].phase).toBe('final');
  });
});
