import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import { VoteService } from '../services/VoteService.js';

// One voter, one continue ballot per round (#227).
//
// `votes` was UNIQUE (round_id, voter_id, kind, client_nonce), so a voter who
// sent N ballots under N fresh nonces was counted N times, and one participant
// could decide whether the debate continues. final_votes was fixed for the same
// problem; continue votes now follow it: a later ballot replaces the earlier one.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';

const describeDb = process.env.DB8_TEST_PG ? describe : describe.skip;
const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'db',
  'schema.sql'
);

describeDb('continue votes count once per voter (database)', () => {
  let pool;
  let app;
  const roomId = '22700000-0000-4000-8000-000000000001';
  const roundId = '22700000-0000-4000-8000-000000000002';
  const voterId = '22700000-0000-4000-8000-000000000003';
  const otherId = '22700000-0000-4000-8000-000000000004';

  const cast = (choice, nonce, voter = voterId) =>
    pool.query('select vote_submit($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text) as id', [
      roundId,
      voter,
      'continue',
      JSON.stringify({ choice }),
      nonce
    ]);
  const rowsFor = async (voter = voterId) =>
    (
      await pool.query(
        "select id, ballot->>'choice' as choice from votes where round_id = $1 and voter_id = $2",
        [roundId, voter]
      )
    ).rows;
  const tally = async () =>
    (
      await pool.query('select yes::int, no::int from view_continue_tally where round_id = $1', [
        roundId
      ])
    ).rows[0];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    const m = await import('../rpc.js');
    app = m.default;
    m.__setDbPool(pool);
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.query('insert into rooms(id, title) values ($1,$2)', [roomId, 'Continue once']);
    await pool.query(
      `insert into rounds(id, room_id, idx, phase, published_at_unix, continue_vote_close_unix)
       values ($1,$2,0,'published',extract(epoch from now())::bigint, extract(epoch from now())::bigint + 600)`,
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name, role) values ($1,$2,$3,$4), ($5,$2,$6,$7)',
      [voterId, roomId, 'once_voter', 'debater', otherId, 'once_other', 'debater']
    );
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.end();
  });

  it('stores one row per voter however many nonces they use, holding the latest choice', async () => {
    await pool.query('delete from votes where round_id = $1', [roundId]);
    const a = await cast('continue', 'once-nonce-1');
    const b = await cast('end', 'once-nonce-2');
    const c = await cast('continue', 'once-nonce-3');
    expect(new Set([a.rows[0].id, b.rows[0].id, c.rows[0].id]).size).toBe(1);
    expect(await rowsFor()).toEqual([{ id: a.rows[0].id, choice: 'continue' }]);
    expect(await tally()).toMatchObject({ yes: 1, no: 0 });
  });

  it('replaying the same nonce still returns the same id', async () => {
    await pool.query('delete from votes where round_id = $1', [roundId]);
    const a = await cast('end', 'once-replay');
    const b = await cast('end', 'once-replay');
    expect(b.rows[0].id).toBe(a.rows[0].id);
  });

  it('one voter cannot outvote another through POST /rpc/vote.continue', async () => {
    await pool.query('delete from votes where round_id = $1', [roundId]);
    const body = { room_id: roomId, round_id: roundId, voter_id: voterId, choice: 'continue' };
    for (const n of ['http-1', 'http-2', 'http-3']) {
      const r = await request(app)
        .post('/rpc/vote.continue')
        .send({ ...body, client_nonce: `once-${n}` })
        .expect(200);
      expect(r.body.note).toBeUndefined();
    }
    await request(app)
      .post('/rpc/vote.continue')
      .send({ ...body, voter_id: otherId, choice: 'end', client_nonce: 'once-http-other' })
      .expect(200);
    expect(await tally()).toMatchObject({ yes: 1, no: 1 });
    const state = await request(app).get(`/state?room_id=${roomId}`).expect(200);
    expect(state.body.round.continue_tally).toEqual({ yes: 1, no: 1 });
  });

  it('upgrading a database that holds duplicate ballots keeps the newest per voter', async () => {
    const client = await pool.connect();
    try {
      // Rebuild the old shape inside a transaction and roll it back afterwards,
      // so the shared test database is left as it was.
      await client.query('BEGIN');
      await client.query('delete from votes where round_id = $1', [roundId]);
      await client.query('alter table votes drop constraint votes_round_id_voter_id_kind_key');
      await client.query(
        'alter table votes add constraint votes_round_id_voter_id_kind_client_nonce_key unique (round_id, voter_id, kind, client_nonce)'
      );
      await client.query(
        `insert into votes (round_id, voter_id, kind, ballot, client_nonce, created_at) values
           ($1, $2, 'continue', '{"choice":"continue"}', 'old-1', now() - interval '3 minutes'),
           ($1, $2, 'continue', '{"choice":"continue"}', 'old-2', now() - interval '2 minutes'),
           ($1, $2, 'continue', '{"choice":"end"}',      'old-3', now() - interval '1 minute'),
           ($1, $3, 'continue', '{"choice":"continue"}', 'old-4', now())`,
        [roundId, voterId, otherId]
      );

      await client.query(await readFile(schemaPath, 'utf8'));

      const rows = await client.query(
        "select voter_id, ballot->>'choice' as choice from votes where round_id = $1 order by voter_id",
        [roundId]
      );
      expect(rows.rows).toEqual([
        { voter_id: voterId, choice: 'end' },
        { voter_id: otherId, choice: 'continue' }
      ]);
      const cons = await client.query(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'votes'::regclass and contype = 'u'"
      );
      expect(cons.rows.map((r) => r.def)).toEqual(['UNIQUE (round_id, voter_id, kind)']);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('continue votes count once per voter (memory)', () => {
  const ids = {
    room_id: '22700000-0000-4000-8000-0000000000a1',
    round_id: '22700000-0000-4000-8000-0000000000a2'
  };
  const voter = '22700000-0000-4000-8000-0000000000a3';
  const other = '22700000-0000-4000-8000-0000000000a4';

  it('a later ballot replaces the earlier one in the tally', async () => {
    const totals = new Map();
    const svc = new VoteService({
      dbRef: { pool: null },
      memVotes: new Map(),
      memVoteTotals: totals
    });
    const a = await svc.castContinueVote({
      ...ids,
      voter_id: voter,
      choice: 'continue',
      client_nonce: 'mem-n-1'
    });
    const b = await svc.castContinueVote({
      ...ids,
      voter_id: voter,
      choice: 'continue',
      client_nonce: 'mem-n-2'
    });
    expect(b.vote_id).toBe(a.vote_id);
    expect(totals.get(ids.room_id)).toEqual({ yes: 1, no: 0 });
    await svc.castContinueVote({ ...ids, voter_id: voter, choice: 'end', client_nonce: 'mem-n-3' });
    expect(totals.get(ids.room_id)).toEqual({ yes: 0, no: 1 });
    await svc.castContinueVote({
      ...ids,
      voter_id: other,
      choice: 'continue',
      client_nonce: 'mem-n-4'
    });
    expect(totals.get(ids.room_id)).toEqual({ yes: 1, no: 1 });
  });
});
