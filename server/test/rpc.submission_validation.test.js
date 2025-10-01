import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../rpc.js';

describe('POST /rpc/submission.create (validation)', () => {
  it('rejects submissions with fewer than 2 citations', async () => {
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: '00000000-0000-0000-0000-000000000003',
      phase: 'submit',
      deadline_unix: 0,
      content: 'Hello world',
      claims: [{ id: 'c1', text: 'Valid claim', support: [{ kind: 'logic', ref: 'r1' }] }],
      citations: [{ url: 'https://example.com' }],
      client_nonce: 'validation-test-1'
    };
    const r = await request(app).post('/rpc/submission.create').send(body);
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(String(r.body.error)).toMatch(/citations/i);
  });
});
