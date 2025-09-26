import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

describe('Watcher transitions (authoritative timers)', () => {
  const ROOM = '00000000-0000-0000-0000-0000000000aa';
  let app;

  beforeEach(async () => {
    // Small windows for test
    process.env.SUBMIT_WINDOW_SEC = '1';
    process.env.CONTINUE_WINDOW_SEC = '1';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000)); // fixed epoch in ms
    // Re-import server with env applied
    const m = await import('../rpc.js?' + Math.random());
    app = m.default;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SUBMIT_WINDOW_SEC;
    delete process.env.CONTINUE_WINDOW_SEC;
  });

  test('submit -> published, then to next round when continue=yes wins', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const r0 = await request(app).get(`/state?room_id=${ROOM}`).expect(200);
    expect(r0.body.round.phase).toBe('submit');
    // advance one second: submit window over -> published
    vi.setSystemTime(new Date((nowSec + 2) * 1000));
    const r1 = await request(app).get(`/state?room_id=${ROOM}`).expect(200);
    expect(r1.body.round.phase).toBe('published');
    // cast two "continue" and one "end"
    await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id: ROOM,
        round_id: '00000000-0000-0000-0000-0000000000bb',
        voter_id: '00000000-0000-0000-0000-0000000000a1',
        choice: 'continue',
        client_nonce: 'nonce-0001'
      })
      .expect(200);
    await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id: ROOM,
        round_id: '00000000-0000-0000-0000-0000000000bb',
        voter_id: '00000000-0000-0000-0000-0000000000a2',
        choice: 'continue',
        client_nonce: 'nonce-0002'
      })
      .expect(200);
    await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id: ROOM,
        round_id: '00000000-0000-0000-0000-0000000000bb',
        voter_id: '00000000-0000-0000-0000-0000000000b1',
        choice: 'end',
        client_nonce: 'nonce-0003'
      })
      .expect(200);
    // advance beyond continue window
    vi.setSystemTime(new Date((nowSec + 4) * 1000));
    const r2 = await request(app).get(`/state?room_id=${ROOM}`).expect(200);
    expect(r2.body.round.phase).toBe('submit');
    expect(r2.body.round.idx).toBe(1);
  });
});
