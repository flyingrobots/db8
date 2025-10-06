import http from 'node:http';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import app, { __setDbPool } from '../rpc.js';

const execFile = promisify(_execFile);

function cliBin() {
  return path.join(process.cwd(), 'bin', 'db8.js');
}

describe('CLI journal pull', () => {
  let server;
  let url;
  const room = '00000000-0000-0000-0000-00000000a001';

  beforeAll(async () => {
    __setDbPool(null);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('pulls journal history to output directory', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'db8-journal-'));
    const env = { ...process.env, DB8_API_URL: url };
    const { stdout } = await execFile(
      'node',
      [cliBin(), 'journal', 'pull', '--room', room, '--history', '--out', tmp],
      { env }
    );

    // Expect at least one round file (round-0.json) to be written
    const out = stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(out.length).toBeGreaterThanOrEqual(1);
    const file = out[0];
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(typeof data.hash).toBe('string');
    const idx = data.round_idx ?? (data.core && data.core.idx);
    expect(typeof idx).toBe('number');
    expect(data.signature && typeof data.signature.sig_b64).toBe('string');
  });

  test('pulls latest single journal when no --history', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'db8-journal-'));
    const env = { ...process.env, DB8_API_URL: url };
    const { stdout } = await execFile(
      'node',
      [cliBin(), 'journal', 'pull', '--room', room, '--out', tmp],
      { env }
    );
    const fp = stdout.trim();
    const j = JSON.parse(await fs.readFile(fp, 'utf8'));
    expect(j && typeof j.hash).toBe('string');
  });
});
