import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { runTick } from '../watcher.js';

const shouldRun = process.env.RUN_PGTAP === '1' || process.env.DB8_TEST_PG === '1';
const dbUrl =
  process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';
const suite = shouldRun ? describe : describe.skip;

suite('Watcher DB flips', () => {
  let pool;
  let roomId;
  let roundId;

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    // Always apply schema/RPC/RLS to keep isolated and deterministic
    const schemaSql = fs.readFileSync(path.resolve('db/schema.sql'), 'utf8');
    await pool.query(schemaSql);
    const rpcSql = fs.readFileSync(path.resolve('db/rpc.sql'), 'utf8');
    await pool.query(rpcSql);
    const rlsSql = fs.readFileSync(path.resolve('db/rls.sql'), 'utf8');
    await pool.query(rlsSql);
    const helpersSql = fs.readFileSync(path.resolve('db/test/helpers.sql'), 'utf8');
    await pool.query(helpersSql);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('flips submit→published when deadline passed', async () => {
    // Create room via RPC and fetch round via secure view
    const rc = await pool.query('select room_create($1) as id', ['Watcher Room']);
    roomId = rc.rows[0].id;
    const cur = await pool.query(
      `select room_id, round_id, idx, phase, submit_deadline_unix
         from view_current_round
        where room_id=$1`,
      [roomId]
    );
    if (cur.rows.length === 0) throw new Error(`no current round found for roomId ${roomId}`);
    roundId = cur.rows[0].round_id;
    // Move deadline to the past via test-only helper RPC
    const now = Math.floor(Date.now() / 1000);
    await pool.query('select round_set_submit_deadline($1,$2)', [roundId, now - 5]);

    await runTick(pool);

    const r = await pool.query(
      `select room_id, round_id, idx, phase, published_at_unix
         from view_current_round
        where room_id=$1`,
      [roomId]
    );
    expect(r.rows[0].phase).toBe('published');
    expect(Number(r.rows[0].published_at_unix || 0)).toBeGreaterThan(0);
  });

  afterAll(async () => {
    try {
      // Use test-only RPCs for teardown to avoid direct table writes
      await pool.query('select round_delete($1)', [roundId]);
      await pool.query('select room_delete($1)', [roomId]);
    } catch {
      // ignore cleanup errors in test teardown
    }
  });
});
