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

  test('reconnects after connection drop and emits JSON lines', async () => {
    let connections = 0;
    const reconnectServer = http.createServer((req, res) => {
      if (req.url.startsWith('/events')) {
        connections += 1;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        const payload = JSON.stringify({ t: 'timer', count: connections });
        res.write(`data: ${payload}\n\n`);
        setTimeout(() => {
          res.end();
        }, 40);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => reconnectServer.listen(0, resolve));
    const port = reconnectServer.address().port;
    const env = {
      ...process.env,
      DB8_API_URL: `http://127.0.0.1:${port}`,
      DB8_ROOM_ID: 'room-reconnect',
      DB8_CLI_TEST_MAX_EVENTS: '2'
    };

    const child = spawn('node', [cliBin(), 'room', 'watch'], { env });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.on('close', (code) => resolve(code));
      child.on('error', reject);
    });
    await new Promise((resolve) => reconnectServer.close(resolve));

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].t).toBe('timer');
    expect(parsed[1].count).toBeGreaterThanOrEqual(2);
    expect(connections).toBeGreaterThanOrEqual(2);
  }, 15000);

  test('quiet suppresses reconnect messages', async () => {
    const quietServer = http.createServer((req, res) => {
      if (req.url.startsWith('/events')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache'
        });
        res.write(`data: ${JSON.stringify({ t: 'timer', count: 1 })}\n\n`);
        setTimeout(() => res.end(), 40);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => quietServer.listen(0, resolve));
    const port = quietServer.address().port;
    const env = {
      ...process.env,
      DB8_API_URL: `http://127.0.0.1:${port}`,
      DB8_ROOM_ID: 'room-quiet',
      DB8_CLI_TEST_MAX_EVENTS: '1'
    };
    const child = spawn('node', [cliBin(), 'room', 'watch', '--quiet'], { env });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    await new Promise((resolve, reject) => {
      child.on('close', resolve);
      child.on('error', reject);
    });
    await new Promise((resolve) => quietServer.close(resolve));

    expect(stderr.trim()).toBe('');
  }, 15000);
});
