import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../rpc.js';

describe('POST /rpc/submission.create (deadline)', () => {
  it('rejects submissions after deadline', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: '00000000-0000-0000-0000-000000000003',
      phase: 'OPENING',
      deadline_unix: past,
      content: 'Hello world',
      claims: [{ id: 'c1', text: 'Valid claim', support: [{ kind: 'logic', ref: 'r1' }] }],
      citations: [{ url: 'https://example.com' }, { url: 'https://example.org' }],
      client_nonce: 'deadline-test-1'
    };
    const r = await request(app).post('/rpc/submission.create').send(body);
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe('deadline_passed');
  });
});
