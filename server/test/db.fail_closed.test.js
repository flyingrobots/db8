import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import { databaseFailure, DatabaseUnavailableError } from '../database-unavailable.js';

// #257: with a database configured, a write the database did not take was
// kept in memory and answered 200 (`note: 'db_fallback'`). Memory is lost on
// restart, so the server now answers 503 and keeps nothing.

const uuid = () => crypto.randomUUID();
const nonce = () => `fc-${uuid()}`;

// A pool whose every query fails the way node-pg fails when it gets no answer.
function failingPool(make) {
  return {
    query: vi.fn(async () => Promise.reject(make())),
    connect: vi.fn(async () => Promise.reject(make()))
  };
}
const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
const dropped = () => new Error('Connection terminated unexpectedly');

const submissionBody = (ids) => ({
  ...ids,
  phase: 'submit',
  deadline_unix: 0,
  content: 'Tariffs reduce imports.',
  claims: [
    {
      id: 'c1',
      term: {
        kind: 'claim',
        subject: { kind: 'named', name: 'tariffs' },
        predicate: 'reduces',
        object: 'imports'
      },
      support: [{ kind: 'logic', ref: 'r' }]
    }
  ],
  citations: [{ url: 'https://example.org/a' }, { url: 'https://example.org/b' }],
  client_nonce: nonce()
});

const writes = [
  ['nonce.issue', () => ({ round_id: uuid(), author_id: uuid() })],
  [
    'submission.create',
    () => submissionBody({ room_id: uuid(), round_id: uuid(), author_id: uuid() })
  ],
  ['submission.flag', () => ({ submission_id: uuid(), reporter_id: uuid() })],
  [
    'vote.continue',
    () => ({
      room_id: uuid(),
      round_id: uuid(),
      voter_id: uuid(),
      choice: 'continue',
      client_nonce: nonce()
    })
  ],
  [
    'vote.final',
    () => ({ round_id: uuid(), voter_id: uuid(), approval: true, client_nonce: nonce() })
  ],
  ['room.create', () => ({ topic: 'Fail closed', client_nonce: nonce() })],
  [
    'score.submit',
    () => ({
      round_id: uuid(),
      judge_id: uuid(),
      participant_id: uuid(),
      e: 1,
      r: 1,
      c: 1,
      v: 1,
      y: 1,
      client_nonce: nonce()
    })
  ],
  [
    'verify.submit',
    () => ({
      round_id: uuid(),
      reporter_id: uuid(),
      submission_id: uuid(),
      verdict: 'true',
      client_nonce: nonce()
    })
  ],
  [
    'research.fetch',
    () => ({
      room_id: uuid(),
      round_id: uuid(),
      participant_id: uuid(),
      url: 'https://example.org/x'
    })
  ],
  ['reputation.update', () => ({ round_id: uuid() })],
  ['participant.fingerprint.set', () => ({ participant_id: uuid(), fingerprint: 'ab'.repeat(32) })]
];

// Every test starts in memory mode; setup.env.js sets DATABASE_URL, so the
// app's own pool would otherwise point at a database that may not run.
beforeEach(() => __setDbPool(null));
afterEach(() => __setDbPool(null));

describe('a configured database that fails: every write answers 503 and keeps nothing', () => {
  it.each(writes)('%s, connection refused: 503, outcome not_stored', async (rpc, body) => {
    __setDbPool(failingPool(refused));
    const res = await request(app).post(`/rpc/${rpc}`).send(body());
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'database_unavailable', outcome: 'not_stored' });
  });

  it.each(writes)('%s, connection dropped mid-statement: 503', async (rpc, body) => {
    __setDbPool(failingPool(dropped));
    const res = await request(app).post(`/rpc/${rpc}`).send(body());
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('database_unavailable');
    expect(res.body.note).toBeUndefined();
  });

  it.each(writes)('%s, pool never initialized: 503, outcome not_stored', async (rpc, body) => {
    __setDbPool(null, { configured: true });
    const res = await request(app).post(`/rpc/${rpc}`).send(body());
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'database_unavailable', outcome: 'not_stored' });
  });
});

describe('a refused write leaves memory untouched', () => {
  async function memoryRoom() {
    const created = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Memory room', cfg: { participant_count: 2 }, client_nonce: nonce() })
      .expect(200);
    const room_id = created.body.room_id;
    const seats = await request(app).get(`/rpc/room.get?room_id=${room_id}`).expect(200);
    const state = await request(app).get(`/state?room_id=${room_id}`).expect(200);
    return {
      room_id,
      round_id: state.body.round.round_id,
      author_id: seats.body.participants[0].id
    };
  }

  it('a continue vote the database did not take is not counted', async () => {
    const ids = await memoryRoom();
    __setDbPool(failingPool(dropped));
    await request(app)
      .post('/rpc/vote.continue')
      .send({
        room_id: ids.room_id,
        round_id: ids.round_id,
        voter_id: ids.author_id,
        choice: 'continue',
        client_nonce: nonce()
      })
      .expect(503);
    __setDbPool(null);
    const state = await request(app).get(`/state?room_id=${ids.room_id}`).expect(200);
    expect(state.body.round.continue_tally ?? { yes: 0, no: 0 }).toMatchObject({ yes: 0 });
  });

  it('a submission the database did not take is not stored', async () => {
    const ids = await memoryRoom();
    const body = submissionBody(ids);
    __setDbPool(failingPool(dropped));
    await request(app).post('/rpc/submission.create').send(body).expect(503);
    __setDbPool(null);
    // Had the first attempt been kept, the same nonce with another document
    // would be refused as nonce_reused (#236).
    const res = await request(app)
      .post('/rpc/submission.create')
      .send({ ...body, content: 'A different document.' });
    expect(res.status).toBe(200);
  });
});

describe('no database configured: memory mode as before', () => {
  it('room.create answers 200 with no note', async () => {
    const res = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Memory mode', client_nonce: nonce() })
      .expect(200);
    expect(res.body.note).toBeUndefined();
  });
});

describe('databaseFailure', () => {
  it('passes through an error the database answered with', () => {
    const rule = Object.assign(new Error('submission_closed'), {
      severity: 'ERROR',
      code: 'P0001'
    });
    expect(databaseFailure(rule)).toBe(rule);
  });

  it.each([
    ['connection refused', 'not_stored', refused()],
    ['connect timeout', 'not_stored', new Error('timeout exceeded when trying to connect')],
    [
      'too many connections',
      'not_stored',
      Object.assign(new Error('sorry, too many clients'), { severity: 'FATAL', code: '53300' })
    ],
    [
      'bad password',
      'not_stored',
      Object.assign(new Error('password authentication failed'), {
        severity: 'FATAL',
        code: '28P01'
      })
    ],
    [
      'statement timeout',
      'not_stored',
      Object.assign(new Error('canceling statement due to statement timeout'), {
        severity: 'ERROR',
        code: '57014'
      })
    ],
    ['connection dropped', 'unknown', dropped()],
    [
      'admin shutdown',
      'unknown',
      Object.assign(new Error('terminating connection'), { severity: 'FATAL', code: '57P01' })
    ]
  ])('%s is an outage with outcome %s', (_name, outcome, err) => {
    const out = databaseFailure(err);
    expect(out).toBeInstanceOf(DatabaseUnavailableError);
    expect(out.outcome).toBe(outcome);
    expect(out.cause).toBe(err);
  });

  it('a failed lookup that writes nothing is never unknown', () => {
    expect(databaseFailure(dropped(), { wrote: false }).outcome).toBe('not_stored');
  });
});

const describeDb = process.env.DB8_TEST_PG ? describe : describe.skip;

describeDb('a commit whose answer was lost (database)', () => {
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';
  const run = uuid().slice(0, 8);
  const id = (n) => `${run}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ids = { room_id: id(1), round_id: id(2), author_id: id(3) };
  let pool;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query('insert into rooms(id, title) values ($1, $2)', [ids.room_id, 'lost commit']);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, 'submit', 0)",
      [ids.round_id, ids.room_id]
    );
    // Two debaters, so one submission does not publish the round early (#229).
    await pool.query(
      "insert into participants(id, room_id, anon_name, role) values ($1, $2, 'agent_1', 'debater'), (gen_random_uuid(), $2, 'agent_2', 'debater')",
      [ids.author_id, ids.room_id]
    );
  });

  afterEach(async () => {
    await pool.query('delete from rooms where id = $1', [ids.room_id]);
    await pool.end();
  });

  it('503 outcome unknown, then a retry with the same nonce stores exactly one row', async () => {
    // The statement commits, then the connection drops before the answer.
    const lossy = {
      query: async (sql, params) => {
        const r = await pool.query(sql, params);
        if (/submission_upsert/.test(sql)) throw dropped();
        return r;
      }
    };
    const body = submissionBody(ids);
    __setDbPool(lossy);
    const first = await request(app).post('/rpc/submission.create').send(body);
    expect(first.status).toBe(503);
    expect(first.body).toEqual({ ok: false, error: 'database_unavailable', outcome: 'unknown' });

    __setDbPool(pool);
    const retry = await request(app).post('/rpc/submission.create').send(body);
    expect(retry.status).toBe(200);
    const rows = await pool.query(
      'select id from submissions where round_id = $1 and author_id = $2',
      [ids.round_id, ids.author_id]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].id).toBe(retry.body.submission_id);
  });
});

describeDb('research.fetch: a failure after the quota increment (database)', () => {
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';
  const run = uuid().slice(0, 8);
  const id = (n) => `${run}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ids = { room_id: id(21), round_id: id(22), participant_id: id(23) };
  let pool;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query('insert into rooms(id, title, config) values ($1, $2, $3)', [
      ids.room_id,
      'research quota',
      JSON.stringify({ max_fetches_per_round: 1 })
    ]);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, 'submit', 0)",
      [ids.round_id, ids.room_id]
    );
  });

  afterEach(async () => {
    await pool.query('delete from research_usage where room_id = $1', [ids.room_id]);
    await pool.query('delete from rooms where id = $1', [ids.room_id]);
    await pool.end();
  });

  it('answers not_stored and does not spend the quota', async () => {
    // The connection drops on the cache lookup, after the quota increment.
    const lossy = (target) => async (sql, params) => {
      if (/FROM research_cache/i.test(sql)) throw dropped();
      return target.query(sql, params);
    };
    const lossyPool = {
      query: lossy(pool),
      connect: async () => {
        const client = await pool.connect();
        return { release: (err) => client.release(err), query: lossy(client) };
      }
    };
    const body = { ...ids, url: `https://example.org/${run}` };
    __setDbPool(lossyPool);
    const first = await request(app).post('/rpc/research.fetch').send(body);
    expect(first.status).toBe(503);
    expect(first.body.outcome).toBe('not_stored');

    __setDbPool(pool);
    const retry = await request(app).post('/rpc/research.fetch').send(body);
    expect(retry.status).toBe(200);
  });
});
