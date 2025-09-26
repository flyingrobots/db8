import app from '../../server/rpc.js';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

function cliBin() {
  return path.join(process.cwd(), 'bin', 'db8.js');
}

describe('CLI room watch (SSE)', () => {
  let server;
  let url;
  const room = 'room-watch';
  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  test('prints at least one event line', async () => {
    const env = { ...process.env, DB8_API_URL: url, DB8_ROOM_ID: room, DB8_CLI_TEST_ONCE: '1' };
    const child = spawn('node', [cliBin(), 'room', 'watch', '--json'], { env });
    let buf = '';
    const got = await new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        reject(new Error('timeout'));
      }, 8000);
      child.stdout.on('data', (d) => {
        buf += d.toString();
        const lines = buf.trim().split(/\n+/);
        if (lines.length >= 1 && lines[0].trim().startsWith('{')) {
          clearTimeout(to);
          resolve(lines[0]);
        }
      });
      child.on('error', reject);
    });
    // Kill the child to avoid dangling process
    child.kill('SIGTERM');
    const j = JSON.parse(got);
    expect(j.t).toBe('timer');
    expect(j.room_id).toBe(room);
  }, 15000);
});
