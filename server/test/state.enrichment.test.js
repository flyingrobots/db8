import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';

// Memory mode by configuration. These rounds exist only in memory; with a
// database configured, vote_submit refuses them as unknown, and since #231 that
// refusal is a 400 rather than a vote quietly counted in memory.
beforeAll(() => __setDbPool(null));

describe('GET /state enrichment', () => {
  it('returns round metadata with deadline and tally', async () => {
    const r = await request(app).get('/state?room_id=roomA').expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.room_id).toBe('roomA');
    expect(typeof r.body.round.submit_deadline_unix).toBe('number');
    expect(r.body.round.continue_tally).toEqual({ yes: 0, no: 0 });
    expect(Array.isArray(r.body.round.transcript)).toBe(true);
  });

  it('updates tally when votes are cast', async () => {
    const ROOM_UUID = '00000000-0000-0000-0000-0000000000CC';
    await request(app).get(`/state?room_id=${ROOM_UUID}`).expect(200);
    await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id: ROOM_UUID,
        round_id: '00000000-0000-0000-0000-000000000002',
        voter_id: '00000000-0000-0000-0000-0000000000AA',
        choice: 'continue',
        client_nonce: 'nonce-0001'
      })
      .expect(200);
    await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id: ROOM_UUID,
        round_id: '00000000-0000-0000-0000-000000000002',
        voter_id: '00000000-0000-0000-0000-0000000000BB',
        choice: 'end',
        client_nonce: 'nonce-0002'
      })
      .expect(200);
    const after = await request(app).get(`/state?room_id=${ROOM_UUID}`).expect(200);
    expect(after.body.round.continue_tally).toEqual({ yes: 1, no: 1 });
    expect(Array.isArray(after.body.round.transcript)).toBe(true);
  });
});
