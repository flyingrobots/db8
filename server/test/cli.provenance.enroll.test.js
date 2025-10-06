import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import http from 'node:http';

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

describe('CLI provenance enroll', () => {
  it('enrolls with --pub-b64 and prints normalized fingerprint', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const pubB64 = Buffer.from(pubDer).toString('base64');
    const expected = 'sha256:' + crypto.createHash('sha256').update(pubDer).digest('hex');
    const args = [
      'provenance',
      'enroll',
      '--participant',
      '00000000-0000-0000-0000-00000000ee01',
      '--pub-b64',
      pubB64
    ];
    const { code, out } = await runCli(args, { DB8_API_URL: baseURL });
    expect(code).toBe(0);
    expect(out).toBe(expected);
  });
});
