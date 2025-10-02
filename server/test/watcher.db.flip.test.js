import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { runTick } from '../watcher.js';

const shouldRun =
  process.env.DB8_TEST_PG === '1' ||
  process.env.RUN_PGTAP === '1' ||
  Boolean(process.env.DB8_TEST_DATABASE_URL);
const dbUrl = process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8';
const suite = shouldRun ? describe : describe.skip;

suite('Watcher DB flips', () => {
  let pool;
  const roomId = '00000000-0000-0000-0000-0000000000aa';
  const roundId = '00000000-0000-0000-0000-0000000000ad';

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    const haveRooms = await pool.query("select to_regclass('public.rooms') as reg");
    if (!haveRooms.rows[0]?.reg) {
      const schemaSql = fs.readFileSync(path.resolve('db/schema.sql'), 'utf8');
      await pool.query(schemaSql);
    }
    const rpcSql = fs.readFileSync(path.resolve('db/rpc.sql'), 'utf8');
    await pool.query(rpcSql);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('flips submit→published when deadline passed', async () => {
    const now = Math.floor(Date.now() / 1000);
    await pool.query(
      `insert into rooms (id, title) values ($1,'Watcher Room') on conflict (id) do nothing`,
      [roomId]
    );
    await pool.query(
      `insert into rounds (id, room_id, idx, phase, submit_deadline_unix)
       values ($1,$2,0,'submit',$3)
       on conflict (id) do update set phase=excluded.phase, submit_deadline_unix=excluded.submit_deadline_unix`,
      [roundId, roomId, now - 5]
    );

    await runTick(pool);

    const r = await pool.query('select phase, published_at_unix from rounds where id=$1', [
      roundId
    ]);
    expect(r.rows[0].phase).toBe('published');
    expect(Number(r.rows[0].published_at_unix || 0)).toBeGreaterThan(0);
  });

  afterAll(async () => {
    try {
      await pool.query('delete from rounds where id = $1', [roundId]);
      await pool.query('delete from rooms where id = $1', [roomId]);
    } catch {
      // ignore cleanup errors in test teardown
    }
  });
});
