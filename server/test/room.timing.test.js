import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';

// #228: a room's round timing comes from its config. continue_vote_seconds sets
// the continue-vote window, and submit_minutes the submit window of every round,
// not only round 0. Without them the windows stay 30 s and 300 s.

const execFile = promisify(_execFile);
const nonce = () => `timing-${crypto.randomUUID()}`;

describe('room.create validates continue_vote_seconds', () => {
  it.each([9, 3601, 1.5])('rejects %j', async (bad) => {
    const res = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Bad window', cfg: { continue_vote_seconds: bad }, client_nonce: nonce() })
      .expect(400);
    expect(res.body.error).toMatch('continue_vote_seconds');
  });
});

describe('memory mode uses the room config for every window', () => {
  beforeAll(() => __setDbPool(null));
  afterEach(() => vi.useRealTimers());

  async function roomWith(cfg) {
    const created = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Timed in memory', cfg, client_nonce: nonce() })
      .expect(200);
    const room_id = created.body.room_id;
    const seats = await request(app).get(`/rpc/room.get?room_id=${room_id}`).expect(200);
    return { room_id, voter_id: seats.body.participants[0].id };
  }
  const state = async (room_id) =>
    (await request(app).get(`/state?room_id=${room_id}`).expect(200)).body.round;

  async function windows(cfg) {
    const { room_id, voter_id } = await roomWith(cfg);
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: start });
    const r0 = await state(room_id);

    vi.setSystemTime(start + (r0.submit_deadline_unix - Math.floor(start / 1000) + 1) * 1000);
    const published = await state(room_id);
    await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id,
        round_id: r0.round_id,
        voter_id,
        choice: 'continue',
        client_nonce: nonce()
      })
      .expect(200);

    vi.setSystemTime((published.continue_vote_close_unix + 1) * 1000);
    const next = await state(room_id);
    return {
      continueWindow: published.continue_vote_close_unix - published.published_at_unix,
      nextIdx: next.idx,
      nextSubmitWindow: next.submit_deadline_unix - Math.floor(Date.now() / 1000)
    };
  }

  it('continue_vote_seconds and submit_minutes set both windows', async () => {
    expect(
      await windows({ participant_count: 2, submit_minutes: 2, continue_vote_seconds: 120 })
    ).toEqual({ continueWindow: 120, nextIdx: 1, nextSubmitWindow: 120 });
  });

  it('a room without them keeps 30 s and 300 s', async () => {
    expect(await windows({ participant_count: 2 })).toEqual({
      continueWindow: 30,
      nextIdx: 1,
      nextSubmitWindow: 300
    });
  });
});

describe('CLI room create --continue-seconds', () => {
  let server;
  let url;
  let received;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        received = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, room_id: crypto.randomUUID() }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}`;
    return () => new Promise((r) => server.close(r));
  });

  const cli = (args) =>
    execFile(process.execPath, [path.join(process.cwd(), 'bin', 'db8.js'), ...args], {
      env: { ...process.env, DB8_API_URL: url, HOME: '/nonexistent-db8-home' },
      timeout: 10_000
    }).then(
      (r) => ({ code: 0, ...r }),
      (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr })
    );

  it('sends cfg.continue_vote_seconds', async () => {
    const r = await cli(['room', 'create', '--topic', 'Slow voters', '--continue-seconds', '120']);
    expect(r.code).toBe(0);
    expect(received.cfg).toEqual({ continue_vote_seconds: 120 });
  });

  it.each(['9', '3601', 'soon'])('rejects --continue-seconds %s', async (bad) => {
    const r = await cli(['room', 'create', '--topic', 'Slow voters', '--continue-seconds', bad]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--continue-seconds/);
  });
});
