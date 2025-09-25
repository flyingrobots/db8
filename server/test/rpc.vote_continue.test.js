import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../rpc.js';

describe('POST /rpc/vote.continue', () => {
  it('is idempotent by client_nonce', async () => {
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      voter_id: '00000000-0000-0000-0000-000000000004',
      choice: 'continue',
      client_nonce: 'nonce-xyz'
    };
    const r1 = await request(app).post('/rpc/vote.continue').send(body).expect(200);
    const r2 = await request(app).post('/rpc/vote.continue').send(body).expect(200);
    expect(r1.body.ok).toBe(true);
    expect(r2.body.ok).toBe(true);
    expect(r1.body.vote_id).toEqual(r2.body.vote_id);
  });
});
