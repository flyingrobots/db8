import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';

let app;
let server;
let baseURL;

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['bin/db8.js', ...args], {
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

describe('CLI journal verify', () => {
  it('verifies latest journal signature', async () => {
    const { code, out } = await runCli(['journal', 'verify'], {
      DB8_API_URL: baseURL,
      DB8_ROOM_ID: 'local'
    });
    expect(code).toBe(0);
    expect(out).toBe('ok');
  });

  it('verifies journal history (single item for memory path)', async () => {
    const { code, out } = await runCli(['journal', 'verify', '--history'], {
      DB8_API_URL: baseURL,
      DB8_ROOM_ID: 'local'
    });
    expect(code).toBe(0);
    expect(out).toBe('ok');
  });
});
