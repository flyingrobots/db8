import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { __setDbPool } from '../rpc.js';

describe('Final Tally View (M4)', () => {
  let pool;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
    await pool.query('truncate rooms cascade');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('view_final_tally should correctly aggregate approval votes', async () => {
    const roomId = '80000000-0000-0000-0000-000000000001';
    const roundId = '80000000-0000-0000-0000-000000000002';
    const p1 = '80000000-0000-0000-0000-000000000003';
    const p2 = '80000000-0000-0000-0000-000000000004';
    const p3 = '80000000-0000-0000-0000-000000000005';

    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Tally Room']);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'published')",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)',
      [p1, roomId, 'v1', p2, roomId, 'v2', p3, roomId, 'v3']
    );

    // 2 Approvals, 1 Reject
    await pool.query("select vote_final_submit($1, $2, true, '[]', 'n1')", [roundId, p1]);
    await pool.query("select vote_final_submit($1, $2, true, '[]', 'n2')", [roundId, p2]);
    await pool.query("select vote_final_submit($1, $2, false, '[]', 'n3')", [roundId, p3]);

    const res = await pool.query('select * from view_final_tally where round_id = $1', [roundId]);
    expect(res.rows[0].approves).toBe('2');
    expect(res.rows[0].rejects).toBe('1');
    expect(res.rows[0].total).toBe('3');
  });
});
