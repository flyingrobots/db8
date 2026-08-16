import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { __setDbPool } from '../rpc.js';

describe('Audit Trail Integration', () => {
  let pool;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  // Each test drops and rebuilds its own room, and clears the audit rows it is
  // about to assert on.
  //
  // Without this the suite depended on the database never having run it before:
  // `submission_upsert` with a nonce that already existed logs `update`, not
  // `create`, and the audit query had no ORDER BY, so a second run could return
  // the older row and fail with `expected 'update' to be 'create'`. `npm test`
  // deliberately runs the suite twice against the same database, so "only true
  // on a pristine database" is a defect the second pass is designed to catch
  // (E9, E10).
  const resetRoom = async (roomId, auditFilter) => {
    await pool.query(auditFilter.sql, auditFilter.params);
    await pool.query('delete from rooms where id = $1', [roomId]);
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records a create in the audit log when a submission is first stored', async () => {
    const roomId = '33343334-0000-0000-0000-000000000001';
    const roundId = '33343334-0000-0000-0000-000000000002';
    const participantId = '33343334-0000-0000-0000-000000000003';

    await resetRoom(roomId, {
      sql: 'delete from admin_audit_log where actor_id = $1',
      params: [participantId]
    });

    // Seed data (fail-fast if constraints collide unexpectedly)
    const roomRes = await pool.query(
      `insert into rooms(id, title) values ($1, $2)
       on conflict (id) do update set title = excluded.title
       returning id`,
      [roomId, 'Audit Room Unique']
    );
    expect(roomRes.rows.length).toBe(1);

    const roundRes = await pool.query(
      `insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, $3)
       on conflict (id) do update set room_id = excluded.room_id, phase = excluded.phase
       returning id`,
      [roundId, roomId, 'submit']
    );
    expect(roundRes.rows.length).toBe(1);

    const partRes = await pool.query(
      `insert into participants(id, room_id, anon_name) values ($1, $2, $3)
       on conflict (id) do update set room_id = excluded.room_id, anon_name = excluded.anon_name
       returning id`,
      [participantId, roomId, 'audit_anon_unique']
    );
    expect(partRes.rows.length).toBe(1);

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

    // Exactly one row, so this cannot pass on a leftover row from an earlier
    // run, and ordered, so it cannot depend on which row Postgres returns first.
    const res = await pool.query(
      'select * from admin_audit_log where entity_type = $1 and actor_id = $2 order by created_at',
      ['submission', participantId]
    );
    expect(res.rows, 'one submission audit row for this actor').toHaveLength(1);
    expect(res.rows[0].action).toBe('create');
    expect(res.rows[0].actor_id).toBe(participantId);
  });

  it('records a vote in the audit log naming the voter', async () => {
    const roomId = '33343334-0000-0000-0000-000000000010';
    const roundId = '33343334-0000-0000-0000-000000000011';
    const participantId = '33343334-0000-0000-0000-000000000012';

    await resetRoom(roomId, {
      sql: 'delete from admin_audit_log where actor_id = $1',
      params: [participantId]
    });

    const roomRes = await pool.query(
      `insert into rooms(id, title) values ($1, $2)
       on conflict (id) do update set title = excluded.title
       returning id`,
      [roomId, 'Vote Audit Room']
    );
    expect(roomRes.rows.length).toBe(1);

    const roundRes = await pool.query(
      `insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, $3)
       on conflict (id) do update set room_id = excluded.room_id, phase = excluded.phase
       returning id`,
      [roundId, roomId, 'published']
    );
    expect(roundRes.rows.length).toBe(1);

    const partRes = await pool.query(
      `insert into participants(id, room_id, anon_name) values ($1, $2, $3)
       on conflict (id) do update set room_id = excluded.room_id, anon_name = excluded.anon_name
       returning id`,
      [participantId, roomId, 'vote_test_anon']
    );
    expect(partRes.rows.length).toBe(1);

    // Call vote_submit
    await pool.query('select vote_submit($1, $2, $3, $4, $5)', [
      roundId,
      participantId,
      'continue',
      '{"choice": "continue"}',
      'vote-nonce-unique-1'
    ]);

    const res = await pool.query(
      'select * from admin_audit_log where entity_type = $1 and actor_id = $2 and action = $3 order by created_at',
      ['vote', participantId, 'vote']
    );
    expect(res.rows, 'one vote audit row for this voter').toHaveLength(1);
    expect(res.rows[0].actor_id).toBe(participantId);
  });

  it('records the watcher as the actor when a due round is published', async () => {
    const roomId = '33343334-0000-0000-0000-000000000020';
    const roundId = '33343334-0000-0000-0000-000000000021';

    await resetRoom(roomId, {
      sql: 'delete from admin_audit_log where entity_id = $1',
      params: [roundId]
    });

    // Seed a due round
    const roomRes = await pool.query(
      `insert into rooms(id, title) values ($1, $2)
       on conflict (id) do update set title = excluded.title
       returning id`,
      [roomId, 'Due Room Unique']
    );
    expect(roomRes.rows.length).toBe(1);

    const roundRes = await pool.query(
      `insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, $3, $4)
       on conflict (id) do update set room_id = excluded.room_id, phase = excluded.phase, submit_deadline_unix = excluded.submit_deadline_unix
       returning id`,
      [
        roundId,
        roomId,
        'submit',
        100 // long ago
      ]
    );
    expect(roundRes.rows.length).toBe(1);

    // Call round_publish_due
    await pool.query('select round_publish_due()');

    const res = await pool.query(
      'select * from admin_audit_log where entity_id = $1 and action = $2 order by created_at',
      [roundId, 'publish']
    );
    expect(res.rows, 'one publish audit row for this round').toHaveLength(1);
    expect(res.rows[0].entity_id).toBe(roundId);
    expect(res.rows[0].system_actor).toBe('watcher');
  });
});
