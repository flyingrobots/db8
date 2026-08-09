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
  });

  afterAll(async () => {
    await pool.end();
  });

  it('view_final_tally should correctly aggregate approval votes', async () => {
    const roomId = '44440000-0000-0000-0000-000000000001';
    const roundId = '44440000-0000-0000-0000-000000000002';
    const p1 = '44440000-0000-0000-0000-000000000003';
    const p2 = '44440000-0000-0000-0000-000000000004';
    const p3 = '44440000-0000-0000-0000-000000000005';

    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict (id) do nothing', [
      roomId,
      'Tally Room'
    ]);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit') on conflict (id) do nothing",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [p1, roomId, 'p1']
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [p2, roomId, 'p2']
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [p3, roomId, 'p3']
    );

    await pool.query("select vote_final_submit($1, $2, true, '[]', 'n1')", [roundId, p1]);
    await pool.query("select vote_final_submit($1, $2, true, '[]', 'n2')", [roundId, p2]);
    await pool.query("select vote_final_submit($1, $2, false, '[]', 'n3')", [roundId, p3]);

    const res = await pool.query('select * from view_final_tally where round_id = $1', [roundId]);
    expect(Number(res.rows[0].approves)).toBe(2);
    expect(Number(res.rows[0].rejects)).toBe(1);
    expect(Number(res.rows[0].total)).toBe(3);
  });
});
