import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { VoteService } from '../services/VoteService.js';
import app, { __setDbPool } from '../rpc.js';

// Memory mode (no database configured) answers without a note. A configured
// database that cannot be reached is an outage (#257): the vote is refused with
// database_unavailable and nothing is counted in memory.

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

describe('VoteService with a failing or absent database', () => {
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

  it('an unreachable database refuses the vote and counts nothing in memory', async () => {
    const memVoteTotals = new Map();
    const memFinalVotes = new Map();
    const svc = new VoteService({
      dbRef: {
        pool: failingPool(
          Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
        ),
        configured: true
      },
      memVotes: new Map(),
      memVoteTotals,
      memFinalVotes
    });
    await expect(
      svc.castContinueVote({ ...ids, choice: 'end', client_nonce: 'nonce-0003' })
    ).rejects.toMatchObject({ message: 'database_unavailable', outcome: 'not_stored' });
    await expect(
      svc.castFinalVote({ ...ids, approval: true, client_nonce: 'nonce-0005' })
    ).rejects.toMatchObject({ message: 'database_unavailable', outcome: 'not_stored' });
    expect(memVoteTotals.size).toBe(0);
    expect(memFinalVotes.size).toBe(0);
  });

  it('a continue vote the database refused is an error, not a memory vote', async () => {
    const svc = service(failingPool(ruleError('round not in voteable phase: submit')));
    await expect(
      svc.castContinueVote({ ...ids, choice: 'continue', client_nonce: 'nonce-0004' })
    ).rejects.toThrow(/voteable phase/);
  });
});

describe('POST /rpc/nonce.issue in memory mode', () => {
  it('issues a nonce without a note', async () => {
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
