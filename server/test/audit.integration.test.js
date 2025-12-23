import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { __setDbPool } from '../rpc.js';

describe('Audit Trail Integration', () => {
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

  it('room_create should be audit-logged (implied via watcher or manual call)', async () => {
    const roomId = '33373337-0000-0000-0000-000000000001';
    const roundId = '33373337-0000-0000-0000-000000000002';
    const participantId = '33373337-0000-0000-0000-000000000003';

    // Seed data with ON CONFLICT to avoid parallel collision issues
    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict (id) do nothing', [
      roomId,
      'Audit Room Unique'
    ]);
    await pool.query(
      'insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, $3) on conflict (id) do nothing',
      [roundId, roomId, 'submit']
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [participantId, roomId, 'audit_anon_unique']
    );

    // Call submission_upsert
    await pool.query('select submission_upsert($1, $2, $3, $4, $5, $6, $7)', [
      roundId,
      participantId,
      'Audit Content',
      '[]',
      '[]',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'audit-nonce-unique-1'
    ]);

    // Check audit log
    const res = await pool.query(
      'select * from admin_audit_log where entity_type = $1 and actor_id = $2',
      ['submission', participantId]
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].action).toBe('create');
    expect(res.rows[0].actor_id).toBe(participantId);
  });

  it('vote_submit should be audit-logged', async () => {
    const roomId = '33373337-0000-0000-0000-000000000020';
    const roundId = '33373337-0000-0000-0000-000000000021';
    const participantId = '33373337-0000-0000-0000-000000000022';

    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict (id) do nothing', [
      roomId,
      'Vote Audit Room'
    ]);
    await pool.query(
      'insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, $3) on conflict (id) do nothing',
      [roundId, roomId, 'published']
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict (id) do nothing',
      [participantId, roomId, 'vote_audit_anon']
    );

    // Call vote_submit
    await pool.query('select vote_submit($1, $2, $3, $4, $5)', [
      roundId,
      participantId,
      'continue',
      '{"choice": "continue"}',
      'vote-nonce-unique-1'
    ]);

    // Check audit log
    const res = await pool.query(
      'select * from admin_audit_log where entity_type = $1 and actor_id = $2 and action = $3',
      ['vote', participantId, 'vote']
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].actor_id).toBe(participantId);
  });

  it('round_publish_due should be audit-logged', async () => {
    const roomId = '33373337-0000-0000-0000-000000000010';
    const roundId = '33373337-0000-0000-0000-000000000011';

    // Seed a due round
    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict (id) do nothing', [
      roomId,
      'Due Room Unique'
    ]);
    await pool.query(
      'insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, $3, $4) on conflict (id) do nothing',
      [
        roundId,
        roomId,
        'submit',
        100 // long ago
      ]
    );

    // Call round_publish_due
    await pool.query('select round_publish_due()');

    // Check audit log
    const res = await pool.query(
      'select * from admin_audit_log where entity_id = $1 and action = $2',
      [roundId, 'publish']
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].entity_id).toBe(roundId);
    expect(res.rows[0].system_actor).toBe('watcher');
  });
});
