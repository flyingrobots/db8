import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// A configured database whose pool failed to initialize is an outage, not
// memory mode (#257): writes answer 503 database_unavailable and are not kept.

vi.mock('pg', () => {
  class Pool {
    constructor() {
      throw new Error('pool init failed');
    }
  }
  return { default: { Pool }, Pool };
});

describe('a configured pool that failed to initialize', () => {
  it('refuses nonce.issue, vote.continue and submission.create with 503', async () => {
    process.env.DATABASE_URL = 'postgresql://postgres:test@localhost:1/none';
    const { default: app } = await import('../rpc.js?pool-init-failure');
    const ids = {
      room_id: '24100000-0000-4000-8000-000000000001',
      round_id: '24100000-0000-4000-8000-000000000002',
      author_id: '24100000-0000-4000-8000-000000000003'
    };
    const refused = { ok: false, error: 'database_unavailable', outcome: 'not_stored' };
    const n = await request(app).post('/rpc/nonce.issue').send(ids).expect(503);
    expect(n.body).toEqual(refused);
    const v = await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id: ids.room_id,
        round_id: ids.round_id,
        voter_id: ids.author_id,
        choice: 'continue',
        client_nonce: 'pool-init-1'
      })
      .expect(503);
    expect(v.body).toEqual(refused);
    const sub = await request(app)
      .post('/rpc/submission.create')
      .send({
        room_id: ids.room_id,
        round_id: ids.round_id,
        author_id: ids.author_id,
        phase: 'submit',
        deadline_unix: 0,
        content: 'not kept anywhere',
        claims: [
          {
            id: 'c1',
            term: {
              kind: 'claim',
              subject: { kind: 'named', name: 'x' },
              predicate: 'is',
              object: 'y'
            },
            support: [{ kind: 'logic', ref: 'r' }]
          }
        ],
        citations: [{ url: 'https://example.org/a' }, { url: 'https://example.org/b' }],
        client_nonce: 'pool-init-sub-1'
      })
      .expect(503);
    expect(sub.body).toEqual(refused);
  });
});
