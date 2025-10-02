import { execFile as _execFile, spawn } from 'node:child_process';
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

  test('device-code flow writes session after prompting for JWT', async () => {
    const HOME = await mkHome();
    const env = { ...process.env, HOME };
    const room = '00000000-0000-0000-0000-0000000000dd';
    const participant = '00000000-0000-0000-0000-0000000000ee';
    const jwt = 'device.jwt.token';

    const child = spawn(
      'node',
      [cli().bin, 'login', '--device-code', '--room', room, '--participant', participant, '--json'],
      { env }
    );

    // Provide JWT when prompted
    await new Promise((resolve) => setTimeout(resolve, 50));
    child.stdin.write(`${jwt}\n`);

    const exitCode = await new Promise((resolve, reject) => {
      child.on('close', (code) => resolve(code));
      child.on('error', reject);
    });
    expect(exitCode).toBe(0);

    const sessPath = path.join(HOME, '.db8', 'session.json');
    const sess = JSON.parse(await fs.readFile(sessPath, 'utf8'));
    expect(sess.room_id).toBe(room);
    expect(sess.participant_id).toBe(participant);
    expect(sess.jwt).toBe(jwt);
    expect(sess.login_via).toBe('device_code');
    expect(sess.device_code).toBeDefined();
  });
});
