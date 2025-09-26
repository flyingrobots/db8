import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const execFile = promisify(_execFile);

async function mkHome() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'db8-home-'));
  // Ensure .db8 exists
  await fs.mkdir(path.join(dir, '.db8'));
  return dir;
}

function cli(...args) {
  const bin = path.join(process.cwd(), 'bin', 'db8.js');
  return { bin, args };
}

describe('CLI login + whoami (session file)', () => {
  test('stores session and whoami reflects it', async () => {
    const HOME = await mkHome();
    const env = { ...process.env, HOME };
    const room = '00000000-0000-0000-0000-000000000001';
    const participant = '00000000-0000-0000-0000-000000000002';
    const jwt = 'test.jwt.token';

    // login
    const { stdout: out1 } = await execFile(
      'node',
      [cli().bin, 'login', '--room', room, '--participant', participant, '--jwt', jwt, '--json'],
      { env }
    );
    const j1 = JSON.parse(out1.trim());
    expect(j1.ok).toBe(true);
    const p = path.join(HOME, '.db8', 'session.json');
    const sess = JSON.parse(await fs.readFile(p, 'utf8'));
    expect(sess.room_id).toBe(room);
    expect(sess.participant_id).toBe(participant);
    expect(sess.jwt).toBe(jwt);

    // whoami reflects session
    const { stdout: out2 } = await execFile('node', [cli().bin, 'whoami', '--json'], { env });
    const j2 = JSON.parse(out2.trim());
    expect(j2.ok).toBe(true);
    expect(j2.room_id).toBe(room);
    expect(j2.participant_id).toBe(participant);
  });
});
