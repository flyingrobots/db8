import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { VoteService } from '../services/VoteService.js';
import app, { __setDbPool } from '../rpc.js';

// `note: 'db_fallback'` tells a client that a configured database failed and the
// write lives only in memory. The MCP agent server (#231) reports it as a failed
// write, so the note must mean exactly that.

const ids = {
  room_id: '31000000-0000-4000-8000-000000000001',
  round_id: '31000000-0000-4000-8000-000000000002',
  voter_id: '31000000-0000-4000-8000-000000000003'
};

function service(pool) {
  return new VoteService({ dbRef: { pool }, memVotes: new Map(), memVoteTotals: new Map() });
}

const failingPool = (err) => ({
  query: async () => {
    throw err;
  }
});

// What pg raises for a RAISE EXCEPTION: the server answered, so it has a severity.
const ruleError = (message) => Object.assign(new Error(message), { severity: 'ERROR' });

describe('VoteService db_fallback note', () => {
  it('memory mode by configuration carries no fallback note', async () => {
    const svc = service(null);
    const c = await svc.castContinueVote({
      ...ids,
      choice: 'continue',
      client_nonce: 'nonce-0001'
    });
    expect(c.vote_id).toBeTruthy();
    expect(c.note).toBeUndefined();
    const f = await svc.castFinalVote({ ...ids, approval: true, client_nonce: 'nonce-0002' });
    expect(f.note).toBeUndefined();
  });

  it('an unreachable database still falls back, with the note', async () => {
    const svc = service(failingPool(new Error('connect ECONNREFUSED')));
    const c = await svc.castContinueVote({ ...ids, choice: 'end', client_nonce: 'nonce-0003' });
    expect(c.note).toBe('db_fallback');
    const again = await svc.castContinueVote({ ...ids, choice: 'end', client_nonce: 'nonce-0003' });
    expect(again).toEqual(c);
  });

  it('a continue vote the database refused is an error, not a memory vote', async () => {
    const svc = service(failingPool(ruleError('round not in voteable phase: submit')));
    await expect(
      svc.castContinueVote({ ...ids, choice: 'continue', client_nonce: 'nonce-0004' })
    ).rejects.toThrow(/voteable phase/);
  });
});

describe('POST /rpc/nonce.issue in memory mode', () => {
  it('issues a nonce without a fallback note', async () => {
    __setDbPool(null);
    const res = await request(app)
      .post('/rpc/nonce.issue')
      .send({ round_id: ids.round_id, author_id: ids.voter_id })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.nonce).toBeTruthy();
    expect(res.body.note).toBeUndefined();
  });
});
