import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import pg from 'pg';
import crypto from 'node:crypto';

// Use DB-backed path for this test (setup file already sets DATABASE_URL)
const app = (await import('../rpc.js')).default;

describe('GET /journal?room_id&idx', () => {
  let server;
  let url;
  let pool;

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    try {
      if (pool && globalThis.__TEST_ROOM_ID) {
        await pool.query('delete from journals where room_id = $1', [globalThis.__TEST_ROOM_ID]);
      }
    } catch (e) {
      void e; // ignore cleanup errors
    }
    if (pool) await pool.end();
    await new Promise((r) => server.close(r));
  });

  it('returns a stored journal row by index (DB)', async () => {
    const room = crypto.randomUUID();
    const idx = 5;
    const hash = 'a'.repeat(64);
    // Seed a row via SQL RPC
    globalThis.__TEST_ROOM_ID = room;
    await pool.query('select journal_upsert($1::uuid,$2::int,$3::text,$4::jsonb,$5::jsonb)', [
      room,
      idx,
      hash,
      JSON.stringify({}),
      JSON.stringify({ idx })
    ]);

    const r = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=${idx}`);
    const body = await r.json().catch(() => ({}));
    expect(r.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.journal?.round_idx).toBe(idx);
    expect(body?.journal?.hash).toBe(hash);
    expect(typeof body?.journal?.signature).toBe('object');
    expect(typeof body?.journal?.core).toBe('object');
    expect(body?.journal?.hash?.length).toBe(64);
  });

  it('404s for a missing index', async () => {
    const room = globalThis.__TEST_ROOM_ID || crypto.randomUUID();
    const r = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=999`);
    expect(r.status).toBe(404);
  });
});
