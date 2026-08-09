import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import app, { __setDbPool } from '../rpc.js';

// Regression for the memory-mode half of the indexed-journal bug.
//
// The 404 guard was placed inside the `if (db)` branch, so it only protected
// the database path. With no pool attached — a supported mode, and the one the
// bulk of this suite runs in — a request for a specific round still fell
// through to buildLatestJournal(), which ignores idx entirely. Asking for round
// 999 of a room that never existed returned 200 and a synthesized round 0,
// because RoomService auto-creates unknown rooms in memory.
//
// Deliberately not gated behind DB8_TEST_PG: the defect lives in the no-database
// path, so the test must run where there is no database.
describe('GET /journal?idx — memory mode', () => {
  let server;
  let url;

  beforeAll(async () => {
    __setDbPool(null);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('404s for a round the room does not have', async () => {
    const room = crypto.randomUUID();
    const res = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=999`);
    expect(res.status).toBe(404);
  });

  it('does not answer an indexed request with a different round', async () => {
    const room = crypto.randomUUID();
    const res = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=999`);
    const body = await res.json().catch(() => ({}));
    // The failure this guards against is subtler than the status code: round 0
    // was returned under ok:true for a request that named round 999.
    expect(body?.journal?.core?.idx).not.toBe(0);
    expect(body?.ok).not.toBe(true);
  });

  it('400s a non-numeric idx rather than coercing it to NaN', async () => {
    const room = crypto.randomUUID();
    const res = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=abc`);
    expect(res.status).toBe(400);
  });

  it('400s a negative idx', async () => {
    const room = crypto.randomUUID();
    const res = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}&idx=-1`);
    expect(res.status).toBe(400);
  });

  it('still serves the latest journal when no idx is given', async () => {
    const room = crypto.randomUUID();
    const res = await fetch(`${url}/journal?room_id=${encodeURIComponent(room)}`);
    expect(res.status).toBe(200);
    expect((await res.json())?.ok).toBe(true);
  });
});
