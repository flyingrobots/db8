import app from '../../server/rpc.js';
import http from 'node:http';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(_execFile);

function cliBin() {
  return path.join(process.cwd(), 'bin', 'db8.js');
}

describe('CLI room status', () => {
  let server;
  let url;
  const room = 'room-test';
  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  test('returns ok with JSON', async () => {
    const env = { ...process.env, DB8_API_URL: url, DB8_ROOM_ID: room };
    const { stdout } = await execFile('node', [cliBin(), 'room', 'status', '--json'], { env });
    const j = JSON.parse(stdout.trim());
    expect(j.ok).toBe(true);
    expect(j.room_id).toBe(room);
    expect(j.round).toBeTruthy();
  });
});
