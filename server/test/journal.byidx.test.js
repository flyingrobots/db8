import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import pg from 'pg';
import crypto from 'node:crypto';

let app;
let __setDbPool;

// Only run when DB-backed tests are enabled
const shouldRun = process.env.RUN_PGTAP === '1' || process.env.DB8_TEST_PG === '1';
const dbUrl =
  process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';

let testRoomId = '';

const suite = shouldRun ? describe : describe.skip;

suite('GET /journal?room_id&idx', () => {
  let server;
  let url;
  let pool;

  beforeAll(async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = dbUrl;
    const mod = await import('../rpc.js');
    app = mod.default;
    __setDbPool = mod.__setDbPool;
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
  });

  afterAll(async () => {
    try {
      if (pool && testRoomId) {
        await pool.query('delete from journals where room_id = $1', [testRoomId]);
        testRoomId = '';
      }
    } catch (e) {
      void e; // ignore cleanup errors
    }
    // Detach DB pool from the app and close
    __setDbPool(null);
    if (pool) await pool.end();
    await new Promise((r) => server.close(r));
  });

  it('returns a stored journal row by index (DB)', async () => {
    const room = crypto.randomUUID();
    const idx = 5;
    const hash = 'a'.repeat(64);
    // Seed a row via SQL RPC
    testRoomId = room;
    await pool.query('select journal_upsert($1::uuid,$2::int,$3::text,$4::jsonb,$5::jsonb)', [
      room,
      idx,
      hash,
      JSON.stringify({}),
      JSON.stringify({ idx })
    ]);

    const r = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=${idx}`);
    const raw = await r.text();
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    if (r.status !== 200) {
      console.error('[journal_by_index] expected 200, got', r.status, 'body=', raw);
    }
    expect(r.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.journal?.round_idx).toBe(idx);
    expect(body?.journal?.hash).toBe(hash);
    expect(typeof body?.journal?.signature).toBe('object');
    expect(typeof body?.journal?.core).toBe('object');
    expect(body?.journal?.hash?.length).toBe(64);
  });

  it('404s for a missing index', async () => {
    const room = crypto.randomUUID();
    const r = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=999`);
    if (r.status !== 404) {
      const body = await r.text();
      console.error('[journal_by_index] expected 404, got', r.status, 'body=', body);
    }
    expect(r.status).toBe(404);
  });
});
