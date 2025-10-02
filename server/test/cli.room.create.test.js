import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import app from '../rpc.js';

function cliBin() {
  return path.join(process.cwd(), 'bin', 'db8.js');
}

describe('CLI room create', () => {
  let server;
  let url;
  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  test('creates a room and prints room_id (JSON)', async () => {
    const env = { ...process.env, DB8_API_URL: url };
    const child = spawn('node', [cliBin(), 'room', 'create', '--topic', 'CLI Demo', '--json'], {
      env
    });
    const TIMEOUT = 15000;
    const { stdout, code } = await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      const to = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore kill errors
        }
        reject(new Error(`timeout. stderr=${err}`));
      }, TIMEOUT);
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (err += d.toString()));
      child.on('close', (code) => {
        clearTimeout(to);
        resolve({ stdout: out.trim(), code });
      });
      child.on('error', reject);
    });
    expect(code).toBe(0);
    const j = JSON.parse(stdout);
    expect(j.ok).toBe(true);
    expect(typeof j.room_id).toBe('string');
  }, 15000);
});
