import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

let app;
let server;
let baseURL;
let __setDbPool;

beforeEach(async () => {
  // Use in-memory path to validate normalization and fallback behavior by default
  process.env.DATABASE_URL = '';
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
  delete process.env.DATABASE_URL;
});

describe('POST /rpc/participant.fingerprint.set', () => {
  it('accepts DER SPKI base64 and returns normalized sha256:<hex>', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const public_key_b64 = Buffer.from(pubDer).toString('base64');
    const expected = 'sha256:' + crypto.createHash('sha256').update(pubDer).digest('hex');

    const res = await fetch(baseURL + '/rpc/participant.fingerprint.set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant_id: '00000000-0000-0000-0000-00000000cc01',
        public_key_b64
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.ok).toBe(true);
    expect(body?.fingerprint).toBe(expected);
  });

  it('accepts explicit fingerprint and normalizes case/prefix', async () => {
    const res = await fetch(baseURL + '/rpc/participant.fingerprint.set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant_id: '00000000-0000-0000-0000-00000000cc02',
        fingerprint: 'AAAAAAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(/^sha256:[0-9a-f]{64}$/.test(body?.fingerprint)).toBe(true);
  });

  it('uses DB RPC when pool provided', async () => {
    const calls = [];
    const fake = {
      async query(text, params) {
        calls.push({ text, params });
        if (/participant_fingerprint_set\(/i.test(String(text))) {
          return {
            rows: [
              {
                fingerprint: String(params[1]).startsWith('sha256:')
                  ? params[1]
                  : 'sha256:deadbeef'.padEnd(71, 'f')
              }
            ]
          };
        }
        throw new Error('unexpected query');
      }
    };
    __setDbPool(fake);
    const res = await fetch(baseURL + '/rpc/participant.fingerprint.set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant_id: '00000000-0000-0000-0000-00000000cc03',
        fingerprint: 'sha256:' + 'b'.repeat(64)
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.ok).toBe(true);
    expect(body?.fingerprint).toBe('sha256:' + 'b'.repeat(64));
    expect(calls[0].text).toMatch(/participant_fingerprint_set/i);
  });
});
