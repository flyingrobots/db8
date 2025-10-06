import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonicalizeSorted, canonicalizeJCS, sha256Hex } from '../utils.js';

// Force in-memory server for these tests
const originalDbUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = '';
const app = (await import('../rpc.js')).default;

let server;
let baseURL;

function testDoc() {
  return {
    room_id: '00000000-0000-0000-0000-000000000001',
    round_id: '00000000-0000-0000-0000-000000000002',
    author_id: '00000000-0000-0000-0000-000000000003',
    phase: 'submit',
    // Use a plausible future timestamp (ms) to avoid epoch edge cases
    deadline_unix: 1700000000000,
    content: 'Hello provenance',
    claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'x' }] }],
    citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
    client_nonce: 'nonce-12345678'
  };
}

beforeEach(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe('POST /rpc/provenance.verify', () => {
  it('verifies an Ed25519 signature over the canonicalized submission', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const public_key_b64 = Buffer.from(pubDer).toString('base64');

    const doc = testDoc();
    const canonicalizer =
      String(process.env.CANON_MODE || 'jcs').toLowerCase() === 'jcs'
        ? canonicalizeJCS
        : canonicalizeSorted;
    const hashHex = sha256Hex(canonicalizer(doc));
    const sig_b64 = Buffer.from(
      crypto.sign(null, Buffer.from(hashHex, 'hex'), privateKey)
    ).toString('base64');

    const res = await fetch(baseURL + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc, signature_kind: 'ed25519', sig_b64, public_key_b64 })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.ok).toBe(true);
    expect(typeof body?.hash).toBe('string');
    expect(/^[0-9a-f]{64}$/.test(body.hash)).toBe(true);
  });

  it('returns 400 for SSH path with missing public_key_ssh', async () => {
    const doc = testDoc();
    const res = await fetch(baseURL + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc, signature_kind: 'ssh', sig_b64: 'x' })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.ok).toBe(false);
    expect(body?.error).toBe('missing_public_key_ssh');
  });

  it('400 when missing public_key_b64 for ed25519', async () => {
    const doc = testDoc();
    const res = await fetch(baseURL + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc, signature_kind: 'ed25519', sig_b64: 'abc' })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.error).toBe('missing_public_key_b64');
  });

  it('400 for invalid public_key_b64', async () => {
    const doc = testDoc();
    const res = await fetch(baseURL + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        doc,
        signature_kind: 'ed25519',
        sig_b64: 'abc',
        public_key_b64: 'not-a-key'
      })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.error).toBe('invalid_public_key_or_signature');
  });

  it('400 for incorrect signature with valid key', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const public_key_b64 = Buffer.from(pubDer).toString('base64');
    const doc = testDoc();
    const res = await fetch(baseURL + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        doc,
        signature_kind: 'ed25519',
        sig_b64: Buffer.from('bad').toString('base64'),
        public_key_b64
      })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.error).toBe('invalid_public_key_or_signature');
  });
});

// Restore env after module
afterEach(() => {
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDbUrl;
});
