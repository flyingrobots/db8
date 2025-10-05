import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import app, { __setDbPool } from '../rpc.js';
import { canonicalizeSorted, canonicalizeJCS, sha256Hex } from '../utils.js';

let server;
let baseURL;

function testDoc() {
  return {
    room_id: '00000000-0000-0000-0000-00000000b001',
    round_id: '00000000-0000-0000-0000-00000000b002',
    author_id: '00000000-0000-0000-0000-00000000b003',
    phase: 'submit',
    deadline_unix: 1700000000000,
    content: 'Hello provenance',
    claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'x' }] }],
    citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
    client_nonce: 'nonce-12345678'
  };
}

function makeStubPool(fingerprint) {
  return {
    async query(text, _params) {
      if (/select\s+ssh_fingerprint\s+from\s+participants/i.test(String(text))) {
        return { rows: [{ ssh_fingerprint: fingerprint }] };
      }
      return { rows: [] };
    }
  };
}

beforeEach(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  __setDbPool(null);
});

describe('provenance.verify author binding (DB)', () => {
  it('200 when fingerprint matches participants.ssh_fingerprint', async () => {
    const doc = testDoc();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const public_key_b64 = Buffer.from(pubDer).toString('base64');
    const expectedFp = `sha256:${crypto.createHash('sha256').update(pubDer).digest('hex')}`;
    __setDbPool(makeStubPool(expectedFp));

    const canonicalizer =
      String(process.env.CANON_MODE || 'sorted').toLowerCase() === 'jcs'
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
    expect(body?.public_key_fingerprint).toBe(expectedFp);
    expect(body?.author_binding).toBe('match');
  });

  it('400 when fingerprint mismatches participants.ssh_fingerprint', async () => {
    const doc = testDoc();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const public_key_b64 = Buffer.from(pubDer).toString('base64');
    const wrong = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    __setDbPool(makeStubPool(wrong));

    const canonicalizer =
      String(process.env.CANON_MODE || 'sorted').toLowerCase() === 'jcs'
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
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.error).toBe('author_binding_mismatch');
    expect(typeof body?.expected_fingerprint).toBe('string');
    expect(typeof body?.got_fingerprint).toBe('string');
  });
});
