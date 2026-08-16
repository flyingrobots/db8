import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// Regression: admin_audit_log.actor_id carried
//   REFERENCES participants(id) ON DELETE SET NULL
// while admin_audit_actor_oneof_ck required exactly one of actor_id or
// system_actor to be set. Deleting a participant nulled actor_id on their audit
// rows, leaving both columns null, so the check constraint rejected the update
// and the delete failed. The two constraints were mutually exclusive: any
// participant who had ever been audited could never be removed.
//
// An audit log is a historical record and must outlive the rows it references,
// so actor_id is now a plain uuid with no foreign key.
describe('audit actor retention', () => {
  let pool;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  const roomId = '5a1d0000-0000-0000-0000-000000000001';
  const roundId = '5a1d0000-0000-0000-0000-000000000002';

  // One participant per test, not one for the file.
  //
  // Both behaviours below need a participant who has been audited and then
  // deleted, and the second test used to rely on the first having done that
  // deletion. Run in the other order it found no audit row and failed with
  // `expected [] to have a length of 1`. Sharing the actor made the pair a
  // script rather than two tests (E11, E12).
  const ACTORS = {
    deletable: '5a1d0000-0000-0000-0000-000000000003',
    retained: '5a1d0000-0000-0000-0000-000000000004'
  };
  const actorIds = Object.values(ACTORS);

  // Arrange an actor who has been audited: the precondition both behaviours
  // start from, so neither depends on the other having established it.
  const auditedActor = async (actorId, anonName) => {
    await pool.query('insert into participants(id, room_id, anon_name) values ($1, $2, $3)', [
      actorId,
      roomId,
      anonName
    ]);
    await pool.query('select admin_audit_log_write($1, $2, $3, $4)', [
      'vote',
      'vote',
      roundId,
      actorId
    ]);
    const written = await pool.query(
      'select count(*)::int as n from admin_audit_log where actor_id = $1',
      [actorId]
    );
    expect(written.rows[0].n, `audit row written for ${anonName}`).toBe(1);
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.query('delete from admin_audit_log where actor_id = any($1)', [actorIds]);
    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Audit Retention']);
    await pool.query("insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit')", [
      roundId,
      roomId
    ]);
  });

  afterAll(async () => {
    await pool.query('delete from admin_audit_log where actor_id = any($1)', [actorIds]);
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.end();
  });

  it('lets a participant be deleted even after they have been audited', async () => {
    await auditedActor(ACTORS.deletable, 'retention_deletable');

    await expect(
      pool.query('delete from participants where id = $1', [ACTORS.deletable])
    ).resolves.toBeDefined();

    const gone = await pool.query('select count(*)::int as n from participants where id = $1', [
      ACTORS.deletable
    ]);
    expect(gone.rows[0].n).toBe(0);
  });

  it('preserves the actor on the audit row after the participant is gone', async () => {
    await auditedActor(ACTORS.retained, 'retention_retained');
    await pool.query('delete from participants where id = $1', [ACTORS.retained]);

    const after = await pool.query(
      'select actor_id, system_actor from admin_audit_log where actor_id = $1',
      [ACTORS.retained]
    );
    expect(after.rows, 'the audit row must outlive the participant').toHaveLength(1);
    expect(after.rows[0].actor_id).toBe(ACTORS.retained);
    expect(after.rows[0].system_actor).toBeNull();
  });

  // Named exactly rather than matched with LIKE: a pattern is allow-by-default
  // and would miss a foreign key added on a differently-named audit table (A14).
  it('no longer constrains actor_id by foreign key', async () => {
    const fk = await pool.query(
      `select count(*)::int as n
         from pg_constraint
        where contype = 'f'
          and confrelid = 'participants'::regclass
          and conrelid = 'admin_audit_log'::regclass`
    );
    expect(fk.rows[0].n, 'admin_audit_log must not reference participants').toBe(0);
  });
});
