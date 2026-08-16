import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

// `CREATE OR REPLACE FUNCTION` replaces a function only when the argument list
// is identical. Add a parameter — even one with a default — and Postgres creates
// a second overload and leaves the original in place. The original then still
// references whatever it referenced before, including an index this schema now
// drops, and a call that fits both signatures fails outright:
//
//   ERROR: function verify_submit(...) is not unique
//
// The test harness rebuilds from schema.sql every run, so a fresh database never
// has the old function and cannot catch this. Only an upgrade can, which is what
// this seeds.
describe('rpc.sql leaves no stale function overloads', () => {
  let pool;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('drops the pre-claim_path verify_submit when rpc.sql is applied over it', async () => {
    // Everything happens inside one connection's transaction and is rolled
    // back, because Vitest runs test files in parallel against a single
    // database: creating a seven-argument verify_submit globally would make
    // concurrent verdict tests fail with "function ... is not unique", and
    // re-applying rpc.sql would churn objects other tests are using.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes against any other runtime DDL applier. db/rpc.sql and
      // db/rls.sql take rooms and rounds in opposite orders, so two appliers
      // running concurrently deadlock. Anything added here that applies DDL
      // must take this same lock.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['db8:schema-ddl']);

      // Seed the shape an existing deployment would be carrying.
      await client.query(`
        CREATE OR REPLACE FUNCTION verify_submit(
          p_round_id uuid, p_reporter_id uuid, p_submission_id uuid,
          p_claim_id text, p_verdict text, p_rationale text, p_client_nonce text
        ) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      `);

      // Matched on arity, not on the identity string: that string carries
      // parameter names, so comparing it to a bare type list never matches.
      const seeded = await client.query(
        `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'verify_submit' AND pronargs = 7`
      );
      expect(seeded.rows[0].n, 'legacy overload should be seeded').toBe(1);

      const sql = fs.readFileSync(path.join(process.cwd(), 'db', 'rpc.sql'), 'utf8');
      await client.query(sql);

      const after = await client.query(
        `SELECT pronargs FROM pg_proc WHERE proname = 'verify_submit' ORDER BY pronargs`
      );
      const arities = after.rows.map((r) => r.pronargs);
      expect(arities, `expected one verify_submit, found ${arities.join(', ')}`).toEqual([8]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
