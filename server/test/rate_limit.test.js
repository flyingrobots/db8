import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';

// We import app once; middleware reads ENFORCE_RATELIMIT per-request now.
import app from '../rpc.js';
import { resetRateLimits } from '../mw/rate-limit.js';

describe('rate-limit middleware', () => {
  let oldEnv;
  beforeEach(() => {
    oldEnv = process.env.ENFORCE_RATELIMIT;
    resetRateLimits();
  });
  afterAll(() => {
    process.env.ENFORCE_RATELIMIT = oldEnv;
  });

  it('sets rate limit headers', async () => {
    const rid = crypto.randomUUID();
    const pid = crypto.randomUUID();
    const res = await request(app)
      .get('/health')
      .set('x-room-id', rid)
      .set('x-participant-id', pid);

    expect(res.headers['x-ratelimit-windowms']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('enforces 429 when enabled via env', async () => {
    process.env.ENFORCE_RATELIMIT = '1';

    // M7: Ensure unique bucket for this specific test
    const rid = crypto.randomUUID();
    const pid = crypto.randomUUID();

    let got429 = false;
    // The default limit is 60 in the middleware
    for (let i = 0; i < 70; i++) {
      const r = await request(app)
        .get('/health')
        .set('x-room-id', rid)
        .set('x-participant-id', pid);
      if (r.status === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });
});
