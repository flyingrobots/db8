import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// `db_fallback` means "a database is configured and could not be used". That
// includes a pool that failed to initialize: the memory path is then reached
// with DATABASE_URL set, and the answer must still say it was not persisted.

vi.mock('pg', () => {
  class Pool {
    constructor() {
      throw new Error('pool init failed');
    }
  }
  return { default: { Pool }, Pool };
});

describe('db_fallback when the configured pool failed to initialize', () => {
  it('labels memory-only answers from nonce.issue, vote.continue and submission.create', async () => {
    process.env.DATABASE_URL = 'postgresql://postgres:test@localhost:1/none';
    const { default: app } = await import('../rpc.js?pool-init-failure');
    const ids = {
      room_id: '24100000-0000-4000-8000-000000000001',
      round_id: '24100000-0000-4000-8000-000000000002',
      author_id: '24100000-0000-4000-8000-000000000003'
    };
    const n = await request(app).post('/rpc/nonce.issue').send(ids).expect(200);
    expect(n.body.note).toBe('db_fallback');
    const v = await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id: ids.room_id,
        round_id: ids.round_id,
        voter_id: ids.author_id,
        choice: 'continue',
        client_nonce: 'pool-init-1'
      })
      .expect(200);
    expect(v.body.note).toBe('db_fallback');
    const sub = await request(app)
      .post('/rpc/submission.create')
      .send({
        room_id: ids.room_id,
        round_id: ids.round_id,
        author_id: ids.author_id,
        phase: 'submit',
        deadline_unix: 0,
        content: 'kept only in memory',
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
      .expect(200);
    expect(sub.body.note).toBe('db_fallback');
  });
});
