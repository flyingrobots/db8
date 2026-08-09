import http from 'node:http';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const execFile = promisify(_execFile);

function cliBin() {
  return path.join(process.cwd(), 'bin', 'db8.js');
}

// The round id the CLI used to hardcode as a "loose stub". Any request still
// carrying this value means round resolution regressed.
const STUB_ROUND = '00000000-0000-0000-0000-000000000002';

const ROOM = '00000000-0000-0000-0000-0000000000c1';
const PARTICIPANT = '00000000-0000-0000-0000-0000000000c2';
const CURRENT_ROUND = '00000000-0000-0000-0000-0000000000c3';
const EXPLICIT_ROUND = '00000000-0000-0000-0000-0000000000c4';

const EXIT = { VALIDATION: 2, AUTH: 3 };

describe('CLI vote commands', () => {
  let server;
  let url;
  let received;

  beforeAll(async () => {
    // A stub API so the test can assert exactly what the CLI sent, rather than
    // inferring it from a success message.
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/state')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ ok: true, round: { round_id: CURRENT_ROUND, phase: 'published' } })
        );
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        received.push({ path: req.url, body: JSON.parse(body || '{}') });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, vote_id: '00000000-0000-0000-0000-0000000000ff' }));
      });
    });
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function env(overrides = {}) {
    return {
      ...process.env,
      DB8_API_URL: url,
      DB8_ROOM_ID: ROOM,
      DB8_PARTICIPANT_ID: PARTICIPANT,
      DB8_JWT: 'test-jwt',
      ...overrides
    };
  }

  async function runCli(argv, overrides) {
    received = [];
    try {
      const { stdout } = await execFile(process.execPath, [cliBin(), ...argv], {
        env: env(overrides)
      });
      return { code: 0, stdout, stderr: '' };
    } catch (err) {
      return { code: err.code, stdout: err.stdout || '', stderr: err.stderr || '' };
    }
  }

  it('resolves the current round from /state instead of the hardcoded stub', async () => {
    const res = await runCli(['vote', 'continue', '--choice', 'continue']);
    expect(res.code).toBe(0);
    const vote = received.find((r) => r.path.includes('vote.continue'));
    expect(vote).toBeDefined();
    expect(vote.body.round_id).toBe(CURRENT_ROUND);
    expect(vote.body.round_id).not.toBe(STUB_ROUND);
    expect(vote.body.choice).toBe('continue');
  });

  it('prefers an explicit --round over the resolved one', async () => {
    const res = await runCli(['vote', 'continue', '--choice', 'end', '--round', EXPLICIT_ROUND]);
    expect(res.code).toBe(0);
    const vote = received.find((r) => r.path.includes('vote.continue'));
    expect(vote.body.round_id).toBe(EXPLICIT_ROUND);
    expect(vote.body.choice).toBe('end');
  });

  it('rejects a choice outside continue|end', async () => {
    const res = await runCli(['vote', 'continue', '--choice', 'maybe']);
    expect(res.code).toBe(EXIT.VALIDATION);
    expect(res.stderr).toMatch(/choice/i);
    expect(received).toHaveLength(0);
  });

  it('rejects a malformed --round rather than sending it', async () => {
    const res = await runCli(['vote', 'continue', '--choice', 'continue', '--round', 'not-a-uuid']);
    expect(res.code).toBe(EXIT.VALIDATION);
    expect(received).toHaveLength(0);
  });

  it('requires credentials before contacting the server', async () => {
    const res = await runCli(['vote', 'continue', '--choice', 'continue'], { DB8_JWT: '' });
    expect(res.code).toBe(EXIT.AUTH);
    expect(received).toHaveLength(0);
  });

  it('resolves the round for vote final too', async () => {
    const res = await runCli(['vote', 'final', '--approve']);
    expect(res.code).toBe(0);
    const vote = received.find((r) => r.path.includes('vote.final'));
    expect(vote).toBeDefined();
    expect(vote.body.round_id).toBe(CURRENT_ROUND);
    expect(vote.body.round_id).not.toBe(STUB_ROUND);
  });

  it('sends the ranking list when one is supplied to vote final', async () => {
    const res = await runCli(['vote', 'final', '--rank', 'a,b,c', '--round', EXPLICIT_ROUND]);
    expect(res.code).toBe(0);
    const vote = received.find((r) => r.path.includes('vote.final'));
    expect(vote.body.round_id).toBe(EXPLICIT_ROUND);
    expect(vote.body.ranking).toEqual(['a', 'b', 'c']);
  });
});
