import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../rpc.js';

describe('GET /rpc/participant', () => {
  it('returns role=judge for judge-* IDs (memory fallback)', async () => {
    const res = await request(app)
      .get('/rpc/participant')
      .query({ room_id: '00000000-0000-0000-0000-000000000001', id: 'judge-123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.role).toBe('judge');
  });

  it('returns role=debater for other IDs (memory fallback)', async () => {
    const res = await request(app)
      .get('/rpc/participant')
      .query({ room_id: '00000000-0000-0000-0000-000000000001', id: 'user-456' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.role).toBe('debater');
  });

  it('returns 400 if params missing', async () => {
    const res = await request(app).get('/rpc/participant');
    expect(res.status).toBe(400);
  });
});
