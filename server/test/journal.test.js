import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

// Use default sorted canonicalization; dev keypair will be generated
const app = (await import('../rpc.js')).default;

describe('GET /journal', () => {
  let server;
  let url;
  const ROOM = 'JOURNAL_ROOM_A';

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('returns a signed journal with a verifiable signature', async () => {
    // Touch state to ensure an in-memory round exists
    await fetch(`${url}/state?room_id=${encodeURIComponent(ROOM)}`).then((r) => r.json());
    const j = await fetch(`${url}/journal?room_id=${encodeURIComponent(ROOM)}`).then((r) =>
      r.json()
    );
    expect(j.ok).toBe(true);
    const { journal } = j;
    expect(journal?.hash).toBeTypeOf('string');
    // Verify signature over the hash using returned public key
    const pubDer = Buffer.from(journal.signature.public_key_b64, 'base64');
    const pubKey = crypto.createPublicKey({ format: 'der', type: 'spki', key: pubDer });
    const ok = crypto.verify(
      null,
      Buffer.from(journal.hash, 'hex'),
      pubKey,
      Buffer.from(journal.signature.sig_b64, 'base64')
    );
    expect(ok).toBe(true);
  });
});
