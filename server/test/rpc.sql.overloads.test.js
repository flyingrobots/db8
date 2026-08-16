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

// The DROP + CREATE for verify_submit, read out of the committed db/rpc.sql so
// this test cannot drift from the file it is asserting about.
function verifySubmitSection() {
  const sql = fs.readFileSync(path.join(process.cwd(), 'db', 'rpc.sql'), 'utf8');
  const start = sql.indexOf('DROP FUNCTION IF EXISTS verify_submit');
  if (start === -1) throw new Error('db/rpc.sql no longer drops the legacy verify_submit');
  const createAt = sql.indexOf('CREATE OR REPLACE FUNCTION verify_submit', start);
  if (createAt === -1) throw new Error('db/rpc.sql no longer creates verify_submit');
  // plpgsql bodies are dollar-quoted; the section ends at the closing $$;
  const end = sql.indexOf('$$;', createAt);
  if (end === -1) throw new Error('could not find the end of verify_submit');
  return sql.slice(start, end + 3);
}

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
    // Isolated into a scratch schema, not merely wrapped in a transaction.
    //
    // Vitest runs test files in parallel against ONE database. Creating a
    // seven-argument verify_submit in `public` makes concurrent verdict tests
    // fail with "function ... is not unique", and holding DDL locks on shared
    // objects deadlocks against their DML. A transaction alone does not help:
    // it is what *holds* the locks.
    //
    // With search_path pointing only at the scratch schema, every unqualified
    // DROP and CREATE below resolves there, so this test cannot touch an object
    // any other test can see. The rollback removes the schema.
    //
    // Anything added here that applies DDL should do the same rather than reach
    // for a lock: isolation removes the contention instead of ordering it.
    const client = await pool.connect();
    const scratch = `db8_ddl_${process.pid}_${Date.now().toString(36)}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA ${scratch}`);
      await client.query(`SET LOCAL search_path = ${scratch}`);

      // Seed the shape an existing deployment would be carrying.
      await client.query(`
        CREATE OR REPLACE FUNCTION verify_submit(
          p_round_id uuid, p_reporter_id uuid, p_submission_id uuid,
          p_claim_id text, p_verdict text, p_rationale text, p_client_nonce text
        ) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      `);

      // Matched on arity, not on the identity string: that string carries
      // parameter names, so comparing it to a bare type list never matches.
      // Scoped to the scratch schema so `public` cannot influence the result.
      const countArities = async () => {
        const r = await client.query(
          `SELECT pronargs FROM pg_proc
            WHERE proname = 'verify_submit'
              AND pronamespace = $1::regnamespace
            ORDER BY pronargs`,
          [scratch]
        );
        return r.rows.map((row) => row.pronargs);
      };

      expect(await countArities(), 'legacy overload should be seeded').toEqual([7]);

      // Only the verify_submit section of the real file, read out of the
      // committed db/rpc.sql so this test cannot drift from what it asserts
      // about. Applying all 1100 lines would replace every view in the schema.
      await client.query(verifySubmitSection());

      const arities = await countArities();
      expect(arities, `expected one verify_submit, found ${arities.join(', ')}`).toEqual([8]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
