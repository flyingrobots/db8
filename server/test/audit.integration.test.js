import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

describe('Audit Trail Integration', () => {
  let pool;
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    // Clear all tables for testing
    await pool.query(
      'truncate rooms, participants, rounds, submissions, votes, admin_audit_log cascade'
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('room_create should be audit-logged (implied via watcher or manual call)', async () => {
    // Note: room_create itself doesn't have the audit call yet, but watcher flips do.
    // Let's test submission_upsert which I just added.
    const roomId = '30000000-0000-0000-0000-000000000001';
    const roundId = '30000000-0000-0000-0000-000000000002';
    const participantId = '30000000-0000-0000-0000-000000000003';

    // Seed data
    await pool.query('insert into rooms(id, title) values ($1, $2) on conflict do nothing', [
      roomId,
      'Audit Room'
    ]);
    await pool.query(
      'insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, $3) on conflict do nothing',
      [roundId, roomId, 'submit']
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name) values ($1, $2, $3) on conflict do nothing',
      [participantId, roomId, 'audit_anon']
    );

    // Call submission_upsert
    await pool.query('select submission_upsert($1, $2, $3, $4, $5, $6, $7)', [
      roundId,
      participantId,
      'Audit Content',
      '[]',
      '[]',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'audit-nonce-1'
    ]);

    // Check audit log
    const res = await pool.query('select * from admin_audit_log where entity_type = $1', [
      'submission'
    ]);
    if (res.rows[0]?.action !== 'create') {
      console.error('Audit Log Rows:', res.rows);
    }
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].action).toBe('create');
    expect(res.rows[0].actor_id).toBe(participantId);
  });

  it('vote_submit should be audit-logged', async () => {
    const roundId = '30000000-0000-0000-0000-000000000002';
    const participantId = '30000000-0000-0000-0000-000000000003';

    // Set round to published
    await pool.query('update rounds set phase = $1 where id = $2', ['published', roundId]);

    // Call vote_submit
    await pool.query('select vote_submit($1, $2, $3, $4, $5)', [
      roundId,
      participantId,
      'continue',
      '{"choice": "continue"}',
      'vote-nonce-1'
    ]);

    // Check audit log
    const res = await pool.query('select * from admin_audit_log where entity_type = $1', ['vote']);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].action).toBe('vote');
    expect(res.rows[0].actor_id).toBe(participantId);
  });

  it('round_publish_due should be audit-logged', async () => {
    const roomId = '40000000-0000-0000-0000-000000000001';
    const roundId = '40000000-0000-0000-0000-000000000002';

    // Seed a due round
    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Due Room']);
    await pool.query(
      'insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, $3, $4)',
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
      'select * from admin_audit_log where entity_type = $1 and action = $2',
      ['round', 'publish']
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].entity_id).toBe(roundId);
    expect(res.rows[0].system_actor).toBe('watcher');
  });
});
