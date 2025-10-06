import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonicalizeSorted, canonicalizeJCS, sha256Hex } from '../utils.js';

let app;
let __setDbPool;
let server;
let baseURL;

function testDoc() {
  return {
    room_id: '00000000-0000-0000-0000-00000000e001',
    round_id: '00000000-0000-0000-0000-00000000e002',
    author_id: '00000000-0000-0000-0000-00000000e003',
    phase: 'submit',
    deadline_unix: 1700000000000,
    content: 'Hello provenance',
    claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'x' }] }],
    citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
    client_nonce: 'nonce-abcdef01'
  };
}

function makeStubPool(nullFingerprint = true) {
  return {
    async query(text, _params) {
      if (/select\s+ssh_fingerprint\s+from\s+participants/i.test(String(text))) {
        return { rows: [{ ssh_fingerprint: nullFingerprint ? null : 'sha256:' + 'a'.repeat(64) }] };
      }
      return { rows: [] };
    }
  };
}

const __origDbUrl = process.env.DATABASE_URL;
const __origEnforce = process.env.ENFORCE_AUTHOR_BINDING;

describe('provenance.verify enforcement (author binding required)', () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = '';
    process.env.ENFORCE_AUTHOR_BINDING = '1';
    const mod = await import('../rpc.js');
    app = mod.default;
    __setDbPool = mod.__setDbPool;
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseURL = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    __setDbPool(null);
    if (__origDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = __origDbUrl;
    if (__origEnforce === undefined) delete process.env.ENFORCE_AUTHOR_BINDING;
    else process.env.ENFORCE_AUTHOR_BINDING = __origEnforce;
  });

  it('400 author_not_configured when fingerprint not enrolled and enforcement enabled', async () => {
    __setDbPool(makeStubPool(true));
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
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.error).toBe('author_not_configured');
  });

  // Non-enforcement behavior is covered by other tests; module-level config caching
  // makes toggling within a single file unreliable in ESM. This case is validated
  // in baseline provenance.verify tests where author_binding === 'not_configured'.
});
