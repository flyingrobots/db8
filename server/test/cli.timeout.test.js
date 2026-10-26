import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

// #235: `--timeout <ms>` was listed in the help and read by no command, so a
// server that accepted the connection and never answered held the CLI forever.

const execFile = promisify(_execFile);
const cli = path.join(process.cwd(), 'bin', 'db8.js');
const room = '23500000-0000-4000-8000-000000000001';

let server;
let apiUrl;
const open = new Set();

beforeAll(async () => {
  // Accepts every request and never answers it.
  server = http.createServer((req, res) => open.add(res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  for (const res of open) res.destroy();
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

async function run(args) {
  const started = performance.now();
  try {
    const { stdout, stderr } = await execFile(process.execPath, [cli, ...args], {
      env: { ...process.env, DB8_API_URL: apiUrl, HOME: '/nonexistent-db8-home' },
      timeout: 10_000
    });
    return { code: 0, stdout, stderr, ms: performance.now() - started };
  } catch (err) {
    return {
      code: err.code,
      stdout: err.stdout,
      stderr: err.stderr,
      ms: performance.now() - started
    };
  }
}

describe('--timeout bounds every API request', () => {
  it.each([
    [['room', 'status', '--room', room]],
    [['room', 'seats', '--room', room]],
    [['room', 'create', '--topic', 'Hanging server']],
    [['journal', 'pull', '--room', room]]
  ])('%j exits 7 within the limit', async (args) => {
    const r = await run([...args, '--timeout', '200']);
    expect(r.code).toBe(7);
    expect(r.ms).toBeLessThan(2000);
    expect(r.stderr).toMatch(/timed out after 200 ms/);
  });

  it('rejects a --timeout that is not a positive integer', async () => {
    const r = await run(['room', 'status', '--room', room, '--timeout', 'soon']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--timeout/);
  });
});
