import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// We import app once; middleware reads ENFORCE_RATELIMIT per-request now.
import app from '../rpc.js';

describe('rate-limit middleware', () => {
  let oldEnv;
  beforeAll(() => {
    oldEnv = process.env.ENFORCE_RATELIMIT;
  });
  afterAll(() => {
    process.env.ENFORCE_RATELIMIT = oldEnv;
  });

  it('sets rate limit headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-ratelimit-windowms']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('enforces 429 when enabled via env', async () => {
    process.env.ENFORCE_RATELIMIT = '1';
    // Fire more than limit (default 60/window), but we won't loop 60 in tests — instead, lower the limit via header shims isn't supported.
    // We'll simulate burst by calling a protected endpoint many times and check that at least one returns 429 after some iterations.
    let got429 = false;
    for (let i = 0; i < 80; i++) {
      // include x-room-id/x-participant-id to keep a stable bucket
      const r = await request(app)
        .get('/health')
        .set('x-room-id', 'r')
        .set('x-participant-id', 'p');
      if (r.status === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });
});
