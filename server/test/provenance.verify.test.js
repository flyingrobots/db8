import { describe, it, expect } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonicalizeSorted, canonicalizeJCS, sha256Hex } from '../utils.js';

// Force in-memory server
process.env.DATABASE_URL = '';
const app = (await import('../rpc.js')).default;

describe('POST /rpc/provenance.verify', () => {
  it('verifies an Ed25519 signature over the canonicalized submission', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const public_key_b64 = Buffer.from(pubDer).toString('base64');

    const doc = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: '00000000-0000-0000-0000-000000000003',
      phase: 'submit',
      deadline_unix: 0,
      content: 'Hello provenance',
      claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'x' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'nonce-12345678'
    };

    // Ask server to canonicalize internally, but we need the hash to sign
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const canonicalizer =
      String(process.env.CANON_MODE || 'sorted').toLowerCase() === 'jcs'
        ? canonicalizeJCS
        : canonicalizeSorted;
    const hashHex = sha256Hex(canonicalizer(doc));
    const sig_b64 = Buffer.from(
      crypto.sign(null, Buffer.from(hashHex, 'hex'), privateKey)
    ).toString('base64');

    const res = await fetch(url + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc, signature_kind: 'ed25519', sig_b64, public_key_b64 })
    });
    const body = await res.json().catch(() => ({}));
    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(typeof body?.hash).toBe('string');
    await new Promise((r) => server.close(r));
  });

  it('returns 501 for SSH signatures (stub)', async () => {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const doc = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: '00000000-0000-0000-0000-000000000003',
      phase: 'submit',
      deadline_unix: 0,
      content: 'Hello',
      claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'x' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'nonce-12345678'
    };
    const res = await fetch(url + '/rpc/provenance.verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc, signature_kind: 'ssh', sig_b64: 'x' })
    });
    expect(res.status).toBe(501);
    await new Promise((r) => server.close(r));
  });
});
