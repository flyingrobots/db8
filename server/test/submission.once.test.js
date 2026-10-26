import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';

// #237: one submission per participant per round. A resubmission (a fresh
// nonce, as `db8 resubmit` sends) replaces the earlier one instead of adding a
// second row that is published and journaled beside it.

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

const claims = [
  {
    id: 'c1',
    term: { kind: 'claim', subject: { kind: 'named', name: 'x' }, predicate: 'is', object: 'y' },
    support: [{ kind: 'logic', ref: 'r' }]
  }
];
const citations = [{ url: 'https://example.org/a' }, { url: 'https://example.org/b' }];
const doc = (ids, content, client_nonce) => ({
  ...ids,
  phase: 'submit',
  deadline_unix: 0,
  content,
  claims,
  citations,
  client_nonce
});

describeDb('one submission per participant per round (database)', () => {
  let pool;
  // A fresh prefix per run: audit rows outlive their rooms, and CI runs the
  // suite twice against one database.
  const run = crypto.randomUUID().slice(0, 8);
  const ids = {
    room_id: `${run}-0000-4000-8000-000000000001`,
    round_id: `${run}-0000-4000-8000-000000000002`,
    author_id: `${run}-0000-4000-8000-000000000003`
  };
  const other = `${run}-0000-4000-8000-000000000004`;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
    await pool.query('insert into rooms(id, title) values ($1, $2)', [ids.room_id, 'once']);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, 'submit', 0)",
      [ids.round_id, ids.room_id]
    );
    await pool.query(
      "insert into participants(id, room_id, anon_name, role) values ($1, $2, 'agent_1', 'debater'), ($3, $2, 'agent_2', 'debater')",
      [ids.author_id, ids.room_id, other]
    );
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [ids.room_id]);
    await pool.end();
  });

  it('a resubmission with a fresh nonce replaces the turn, keeping its id', async () => {
    const first = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'Draft one.', `once-${run}-1`))
      .expect(200);
    const second = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'Draft two.', `once-${run}-2`))
      .expect(200);
    expect(second.body.submission_id).toBe(first.body.submission_id);
    const rows = await pool.query(
      'select content, canonical_sha256, version from submissions where round_id = $1 and author_id = $2',
      [ids.round_id, ids.author_id]
    );
    expect(rows.rows).toEqual([
      { content: 'Draft two.', canonical_sha256: second.body.canonical_sha256, version: 2 }
    ]);
    const audit = await pool.query(
      "select action, details from admin_audit_log where entity_type = 'submission' and entity_id = $1 order by created_at, id",
      [first.body.submission_id]
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['create', 'update']);
    expect(audit.rows[1].details).toMatchObject({
      version: 2,
      previous_sha256: first.body.canonical_sha256,
      canonical_sha256: second.body.canonical_sha256
    });
  });

  it('replaying the same nonce and document returns the same id without a new version', async () => {
    const body = doc(ids, 'Draft two.', `once-${run}-2`);
    const replay = await request(app).post('/rpc/submission.create').send(body).expect(200);
    const row = await pool.query(
      'select id, version from submissions where round_id = $1 and author_id = $2',
      [ids.round_id, ids.author_id]
    );
    expect(row.rows).toEqual([{ id: replay.body.submission_id, version: 2 }]);
  });

  it('/state and the journal list one submission per author after publish', async () => {
    await request(app)
      .post('/rpc/submission.create')
      .send(doc({ ...ids, author_id: other }, 'The other seat.', `once-${run}-o`))
      .expect(200);
    await pool.query("update rounds set phase = 'published' where id = $1", [ids.round_id]);
    const state = await request(app).get(`/state?room_id=${ids.room_id}`).expect(200);
    const authors = state.body.round.transcript.map((t) => t.author_id).sort();
    expect(authors).toEqual([ids.author_id, other].sort());
    expect(state.body.round.transcript.find((t) => t.author_id === ids.author_id).content).toBe(
      'Draft two.'
    );
    const journal = await request(app).get(`/journal?room_id=${ids.room_id}`).expect(200);
    const core = journal.body.journal?.core ?? journal.body.core;
    expect(core.transcript_hashes).toHaveLength(2);
  });

  it('upgrading a database with several drafts per author keeps the newest', async () => {
    // Its own database: re-applying db/schema.sql takes schema-wide locks that
    // sibling suites must not run into.
    const name = `db8_sub_upgrade_${process.pid}_${Date.now()}`;
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(dbUrl);
    url.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: url.toString() });
    try {
      await db.connect();
      const schema = await readFile(schemaPath, 'utf8');
      await db.query(schema);
      await db.query('alter table submissions drop constraint submissions_round_id_author_id_key');
      await db.query(
        'alter table submissions add constraint submissions_round_id_author_id_client_nonce_key unique (round_id, author_id, client_nonce)'
      );
      await db.query('insert into rooms(id, title) values ($1, $2)', [ids.room_id, 'up']);
      await db.query("insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit')", [
        ids.round_id,
        ids.room_id
      ]);
      await db.query(
        "insert into participants(id, room_id, anon_name, role) values ($1, $2, 'a1', 'debater'), ($3, $2, 'a2', 'debater')",
        [ids.author_id, ids.room_id, other]
      );
      const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
      await db.query(
        `insert into submissions (round_id, author_id, content, canonical_sha256, client_nonce, submitted_at) values
           ($1, $2, 'old', $4, 'n1', now() - interval '2 minutes'),
           ($1, $2, 'new', $5, 'n2', now() - interval '1 minute'),
           ($1, $3, 'only', $6, 'n3', now())`,
        [ids.round_id, ids.author_id, other, sha('old'), sha('new'), sha('only')]
      );

      await db.query(schema);

      const rows = await db.query('select author_id, content from submissions order by content');
      expect(rows.rows).toEqual([
        { author_id: ids.author_id, content: 'new' },
        { author_id: other, content: 'only' }
      ]);
      const cons = await db.query(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'submissions'::regclass and contype = 'u'"
      );
      expect(cons.rows.map((r) => r.def)).toEqual(['UNIQUE (round_id, author_id)']);
    } finally {
      await db.end().catch(() => {});
      await admin.query(`drop database if exists ${name}`);
      await admin.end();
    }
  });
});

describe('one submission per participant per round (memory)', () => {
  beforeAll(() => __setDbPool(null));

  it('a resubmission replaces the turn in the published transcript', async () => {
    const created = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Once in memory', cfg: { participant_count: 2, submit_minutes: 1 } })
      .expect(200);
    const room_id = created.body.room_id;
    const seats = (await request(app).get(`/rpc/room.get?room_id=${room_id}`)).body.participants;
    const state0 = (await request(app).get(`/state?room_id=${room_id}`)).body;
    const ids = { room_id, round_id: state0.round.round_id, author_id: seats[0].id };
    const a = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'Draft one.', 'mem-once-1'))
      .expect(200);
    const b = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'Draft two.', 'mem-once-2'))
      .expect(200);
    expect(b.body.submission_id).toBe(a.body.submission_id);
    // Publish by moving the clock past the deadline.
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      const state = (await request(app).get(`/state?room_id=${room_id}`)).body;
      expect(state.round.phase).toBe('published');
      expect(state.round.transcript.map((t) => t.content)).toEqual(['Draft two.']);
    } finally {
      Date.now = realNow;
    }
  });
});
