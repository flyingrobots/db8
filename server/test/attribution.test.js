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
    // Note: avoid global TRUNCATE here to prevent race conditions with other tests if possible,
    // or ensure unique IDs are used everywhere.
  });

  afterAll(async () => {
    await pool.end();
  });

  it('submissions_view should mask author_id when attribution_mode is masked', async () => {
    const roomId = '60000000-0000-0000-0000-000000000001';
    const roundId = '60000000-0000-0000-0000-000000000002';
    const participantId = '60000000-0000-0000-0000-000000000003';
    const submissionId = '60000000-0000-0000-0000-000000000004';

    const client = await pool.connect();
    try {
      await client.query('begin');

      // Seed room with masked attribution
      await client.query(
        'insert into rooms(id, title, config) values ($1, $2, $3::jsonb) on conflict (id) do update set title = excluded.title, config = excluded.config',
        [roomId, 'Masked Room', '{"attribution_mode":"masked"}']
      );
      await client.query(
        "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit') on conflict (id) do update set room_id = excluded.room_id, phase = excluded.phase",
        [roundId, roomId]
      );
      await client.query(
        'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do update set room_id = excluded.room_id, anon_name = excluded.anon_name',
        [participantId, roomId, 'Agent 1']
      );
      await client.query(
        "insert into submissions(id, round_id, author_id, content, canonical_sha256, client_nonce) values ($1, $2, $3, 'Content', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'nonce-attrib-1') on conflict (id) do nothing",
        [submissionId, roundId, participantId]
      );

      // Query view as a DIFFERENT participant
      await client.query("select set_config('db8.participant_id', $1, true)", [
        '00000000-0000-0000-0000-000000000000'
      ]);
      const res = await client.query('select * from submissions_view where id = $1', [
        submissionId
      ]);

      // In 'submit' phase, other authors should be NULL if masked
      expect(res.rows[0].author_id).toBeNull();
      expect(res.rows[0].author_anon_name).toBe('Agent 1');

      // Query view as the AUTHOR
      await client.query("select set_config('db8.participant_id', $1, true)", [participantId]);
      const resAuth = await client.query('select * from submissions_view where id = $1', [
        submissionId
      ]);
      expect(resAuth.rows.length).toBe(1);
      expect(resAuth.rows[0].author_id).toBe(participantId);
    } finally {
      try {
        await client.query('rollback');
      } catch {
        /* ignore */
      }
      client.release();
    }
  });

  it('submissions_view should reveal author_id in masked mode if phase is NOT submit', async () => {
    const roomId = '60000000-0000-0000-0000-000000000010';
    const roundId = '60000000-0000-0000-0000-000000000011';
    const participantId = '60000000-0000-0000-0000-000000000012';
    const submissionId = '60000000-0000-0000-0000-000000000013';

    const client = await pool.connect();
    try {
      await client.query('begin');

      await client.query(
        'insert into rooms(id, title, config) values ($1, $2, $3::jsonb) on conflict (id) do update set title = excluded.title, config = excluded.config',
        [roomId, 'Masked Room Published', '{"attribution_mode":"masked"}']
      );
      await client.query(
        "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'published') on conflict (id) do update set room_id = excluded.room_id, phase = excluded.phase",
        [roundId, roomId]
      );
      await client.query(
        'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do update set room_id = excluded.room_id, anon_name = excluded.anon_name',
        [participantId, roomId, 'Agent 1']
      );
      await client.query(
        "insert into submissions(id, round_id, author_id, content, canonical_sha256, client_nonce) values ($1, $2, $3, 'Content', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'nonce-attrib-2') on conflict (id) do nothing",
        [submissionId, roundId, participantId]
      );

      // Query view as a DIFFERENT participant
      await client.query("select set_config('db8.participant_id', $1, true)", [
        '00000000-0000-0000-0000-000000000000'
      ]);
      const res = await client.query('select * from submissions_view where id = $1', [
        submissionId
      ]);

      // After submit phase, id is visible but UI should still prefer anon_name
      expect(res.rows[0].author_id).toBe(participantId);
      expect(res.rows[0].author_anon_name).toBe('Agent 1');
    } finally {
      try {
        await client.query('rollback');
      } catch {
        /* ignore */
      }
      client.release();
    }
  });
});
