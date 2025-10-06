import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonicalizeJCS, canonicalizeSorted, sha256Hex } from '../utils.js';

let app;
let server;
let baseURL;

function toOpenSshEd25519(pubKey) {
  // pubKey: KeyObject for ed25519 public key
  const jwk = pubKey.export({ format: 'jwk' });
  const xB64u = jwk.x; // base64url
  const x = Buffer.from(xB64u.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (x.length !== 32) throw new Error('bad ed25519 length');
  const type = Buffer.from('ssh-ed25519');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(type.length, 0);
  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(x.length, 0);
  const payload = Buffer.concat([len, type, keyLen, x]);
  const b64 = payload.toString('base64');
  return `ssh-ed25519 ${b64} test`;
}

function testDoc() {
  return {
    room_id: '00000000-0000-0000-0000-00000000f001',
    round_id: '00000000-0000-0000-0000-00000000f002',
    author_id: '00000000-0000-0000-0000-00000000f003',
    phase: 'submit',
    deadline_unix: 1700000000000,
    content: 'Hello SSH provenance',
    claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'x' }] }],
    citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
    client_nonce: 'nonce-ssh-1234'
  };
}

beforeEach(async () => {
  process.env.DATABASE_URL = '';
  const mod = await import('../rpc.js');
  app = mod.default;
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  delete process.env.DATABASE_URL;
});

describe('POST /rpc/provenance.verify (ssh-ed25519)', () => {
  it('verifies an ssh-ed25519 OpenSSH public key + signature', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubSsh = toOpenSshEd25519(publicKey);
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
      body: JSON.stringify({ doc, signature_kind: 'ssh', sig_b64, public_key_ssh: pubSsh })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.ok).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(body?.hash)).toBe(true);
    expect(/^sha256:[0-9a-f]{64}$/.test(body?.public_key_fingerprint)).toBe(true);
  });

  it('400 invalid_ssh_public_key when malformed', async () => {
    const doc = testDoc();
    const res = await fetch(baseURL + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        doc,
        signature_kind: 'ssh',
        sig_b64: 'abc',
        public_key_ssh: 'ssh-ed25519 not-base64'
      })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.error).toBe('invalid_ssh_public_key');
  });

  it('400 invalid_public_key_or_signature when signature mismatches', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubSsh = toOpenSshEd25519(publicKey);
    const doc = testDoc();
    const res = await fetch(baseURL + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        doc,
        signature_kind: 'ssh',
        sig_b64: Buffer.from('bad').toString('base64'),
        public_key_ssh: pubSsh
      })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.error).toBe('invalid_public_key_or_signature');
  });
});
