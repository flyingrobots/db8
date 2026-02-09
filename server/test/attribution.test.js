import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { __setDbPool } from '../rpc.js';

describe('Attribution Control (M4)', () => {
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

  it('submissions_view should mask author_id when attribution_mode is masked', async () => {
    const roomId = '60000000-0000-0000-0000-000000000001';
    const roundId = '60000000-0000-0000-0000-000000000002';
    const participantId = '60000000-0000-0000-0000-000000000003';

    // Seed room with masked attribution
    await pool.query(
      'insert into rooms(id, title, config) values ($1, $2, \'{"attribution_mode": "masked"}\')',
      [roomId, 'Masked Room']
    );
    await pool.query("insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit')", [
      roundId,
      roomId
    ]);
    await pool.query(
      "insert into participants(id, room_id, anon_name) values ($1, $2, 'Agent 1')",
      [participantId, roomId]
    );
    await pool.query(
      "insert into submissions(round_id, author_id, content, canonical_sha256, client_nonce) values ($1, $2, 'Content', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'nonce-1')",
      [roundId, participantId]
    );

    // Query view as a DIFFERENT participant
    await pool.query("set db8.participant_id = '00000000-0000-0000-0000-000000000000'");
    const res = await pool.query(
      'select * from submissions_view where id = (select id from submissions limit 1)'
    );

    // In 'submit' phase, other authors should be NULL if masked
    expect(res.rows[0].author_id).toBeNull();
    expect(res.rows[0].author_anon_name).toBe('Agent 1');

    // Query view as the AUTHOR
    await pool.query("select set_config('db8.participant_id', $1, false)", [participantId]);
    const resAuth = await pool.query('select * from submissions_view where author_id = $1', [
      participantId
    ]);
    expect(resAuth.rows.length).toBe(1);
    expect(resAuth.rows[0].author_id).toBe(participantId);
  });

  it('submissions_view should reveal author_id in masked mode if phase is NOT submit', async () => {
    const roundId = '60000000-0000-0000-0000-000000000002';
    const participantId = '60000000-0000-0000-0000-000000000003';

    await pool.query("update rounds set phase = 'published' where id = $1", [roundId]);

    // Query view as a DIFFERENT participant
    await pool.query("set db8.participant_id = '00000000-0000-0000-0000-000000000000'");
    const res = await pool.query('select * from submissions_view where round_id = $1', [roundId]);

    // After submit phase, id is visible but UI should still prefer anon_name
    expect(res.rows[0].author_id).toBe(participantId);
    expect(res.rows[0].author_anon_name).toBe('Agent 1');
  });
});
