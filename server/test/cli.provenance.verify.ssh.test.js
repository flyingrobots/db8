import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import canonicalizePkg from 'canonicalize';

let app;
let server;
let baseURL;
let __tmpDir = '';

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const bin = path.resolve('bin/db8.js');
    const p = spawn(process.execPath, [bin, ...args], {
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

function toOpenSshEd25519(pubKey) {
  const jwk = pubKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const type = Buffer.from('ssh-ed25519');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(type.length, 0);
  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(x.length, 0);
  const payload = Buffer.concat([len, type, keyLen, x]);
  const b64 = payload.toString('base64');
  return `ssh-ed25519 ${b64}`;
}

beforeEach(async () => {
  process.env.DATABASE_URL = '';
  process.env.CANON_MODE = 'jcs';
  const mod = await import('../rpc.js');
  app = mod.default;
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  __tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db8-test-'));
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  delete process.env.DATABASE_URL;
  delete process.env.CANON_MODE;
  if (__tmpDir) {
    await fs.rm(__tmpDir, { recursive: true, force: true }).catch(() => {});
    __tmpDir = '';
  }
});

describe('CLI provenance verify (ssh-ed25519)', () => {
  it('verifies a doc with --kind ssh and --pub-ssh', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubSsh = toOpenSshEd25519(publicKey);
    const doc = {
      room_id: '00000000-0000-0000-0000-00000000f101',
      round_id: '00000000-0000-0000-0000-00000000f102',
      author_id: '00000000-0000-0000-0000-00000000f103',
      phase: 'submit',
      deadline_unix: 1700000000000,
      content: 'Hello SSH provenance (CLI)',
      claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'x' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'nonce-ssh-cli'
    };
    const canon = canonicalizePkg(doc);
    const hashHex = crypto.createHash('sha256').update(canon).digest('hex');
    const sig_b64 = Buffer.from(
      crypto.sign(null, Buffer.from(hashHex, 'hex'), privateKey)
    ).toString('base64');

    const tmp = path.join(__tmpDir, 'doc.json');
    await fs.writeFile(tmp, JSON.stringify(doc));

    const pubPath = path.join(__tmpDir, 'id_ed25519.pub');
    await fs.writeFile(pubPath, pubSsh);
    const { code, out } = await runCli(
      [
        'provenance',
        'verify',
        '--file',
        tmp,
        '--kind',
        'ssh',
        '--sig-b64',
        sig_b64,
        '--pub-ssh',
        `@${pubPath}`
      ],
      { DB8_API_URL: baseURL }
    );
    expect(code).toBe(0);
    expect(/ok [0-9a-f]{64}/.test(out)).toBe(true);
  });
});
