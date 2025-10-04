import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import pg from 'pg';

// Use DB-backed path for this test (setup file already sets DATABASE_URL)
const app = (await import('../rpc.js')).default;

describe('GET /journal?room_id&idx', () => {
  let server;
  let url;

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('returns a stored journal row by index (DB)', async () => {
    const room = '11111111-1111-1111-1111-11111111111a';
    const idx = 5;
    const hash = 'a'.repeat(64);
    // Seed a row via SQL RPC
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query('select journal_upsert($1::uuid,$2::int,$3::text,$4::jsonb,$5::jsonb)', [
        room,
        idx,
        hash,
        JSON.stringify({}),
        JSON.stringify({ idx })
      ]);
    } finally {
      await pool.end();
    }

    const r = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=${idx}`);
    const body = await r.json().catch(() => ({}));
    expect(r.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.journal?.round_idx).toBe(idx);
    expect(body?.journal?.hash).toBe(hash);
  });

  it('404s for a missing index', async () => {
    const room = '11111111-1111-1111-1111-11111111111a';
    const r = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=999`);
    expect(r.status).toBe(404);
  });
});
