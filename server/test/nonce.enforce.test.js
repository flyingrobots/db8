import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

// Enable server nonce enforcement before importing app; force memory path
process.env.ENFORCE_SERVER_NONCES = '1';
process.env.DATABASE_URL = '';
const app = (await import('../rpc.js')).default;

describe('Server-issued nonces (enforced)', () => {
  let server;
  let url;
  const round = '00000000-0000-0000-0000-0000000000aa';
  const room = '00000000-0000-0000-0000-0000000000a0';
  const author = '00000000-0000-0000-0000-0000000000bb';

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('rejects submission without issued nonce', async () => {
    const res = await fetch(url + '/rpc/submission.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: room,
        round_id: round,
        author_id: author,
        phase: 'submit',
        deadline_unix: 0,
        content: 'hello',
        claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'r1' }] }],
        citations: [{ url: 'https://example.com' }, { url: 'https://example.org' }],
        client_nonce: 'not-issued'
      })
    });
    expect(res.status).toBe(400);
  });

  it('accepts single-use nonce and rejects reuse', async () => {
    // Issue
    const issued = await fetch(url + '/rpc/nonce.issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ round_id: round, author_id: author, ttl_sec: 60 })
    }).then((r) => r.json());
    expect(issued.ok).toBe(true);
    const nonce = issued.nonce;

    // Submit with nonce
    const payload = {
      room_id: room,
      round_id: round,
      author_id: author,
      phase: 'submit',
      deadline_unix: 0,
      content: 'hello',
      claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'r1' }] }],
      citations: [{ url: 'https://example.com' }, { url: 'https://example.org' }],
      client_nonce: nonce
    };
    const r1 = await fetch(url + '/rpc/submission.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then((r) => r.json());
    expect(r1.ok).toBe(true);

    // Reuse should fail
    const r2 = await fetch(url + '/rpc/submission.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    expect(r2.status).toBe(400);
  });
});
