import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import canonicalizePkg from 'canonicalize';

let app;
let server;
let baseURL;

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const bin = path.resolve('bin/db8.js');
    const p = spawn('node', [bin, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
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

describe('CLI provenance verify', () => {
  it('verifies ed25519 signature and prints hash + fingerprint', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const public_key_b64 = Buffer.from(pubDer).toString('base64');

    const doc = {
      room_id: '00000000-0000-0000-0000-00000000dd01',
      round_id: '00000000-0000-0000-0000-00000000dd02',
      author_id: '00000000-0000-0000-0000-00000000dd03',
      phase: 'submit',
      deadline_unix: 1700000000000,
      content: 'Hello provenance',
      claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'x' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'nonce-xyz'
    };
    const canon = canonicalizePkg(doc);
    const hashHex = crypto.createHash('sha256').update(canon).digest('hex');
    const sig = crypto.sign(null, Buffer.from(hashHex, 'hex'), privateKey);
    const sig_b64 = Buffer.from(sig).toString('base64');

    const tmp = path.join(process.cwd(), '.tmp.prov.doc.json');
    await fs.writeFile(tmp, JSON.stringify(doc));

    const { code, out } = await runCli(
      [
        'provenance',
        'verify',
        '--file',
        tmp,
        '--kind',
        'ed25519',
        '--sig-b64',
        sig_b64,
        '--pub-b64',
        public_key_b64
      ],
      { DB8_API_URL: baseURL }
    );
    expect(code).toBe(0);
    expect(/ok [0-9a-f]{64}/.test(out)).toBe(true);
  });
});
