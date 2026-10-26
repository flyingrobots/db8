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
const rpcPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'db',
  'rpc.sql'
);
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
  const round2 = `${run}-0000-4000-8000-000000000005`;
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');

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
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 1, 'submit', 0)",
      [round2, ids.room_id]
    );
    // A debater who never submits, so the early-publish rule (#229) cannot
    // publish these rounds under the tests when a sibling suite's watcher
    // sweeps round_publish_due() concurrently.
    await pool.query(
      "insert into participants(id, room_id, anon_name, role) values ($1, $2, 'agent_3', 'debater')",
      [`${run}-0000-4000-8000-000000000009`, ids.room_id]
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

  it('a replacement after the round has published is refused', async () => {
    // A replacement now would keep the submission id, and with it the verdicts
    // judges gave the old claims. Set the phase here rather than relying on the
    // test above having published the round.
    await pool.query("update rounds set phase = 'published' where id = $1", [ids.round_id]);
    const res = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'Rewritten after publish.', `once-${run}-late`))
      .expect(409);
    expect(res.body.error).toBe('submission_closed');
    const row = await pool.query(
      'select content from submissions where round_id = $1 and author_id = $2',
      [ids.round_id, ids.author_id]
    );
    expect(row.rows).toEqual([{ content: 'Draft two.' }]);
  });

  it('a replacement after the submit deadline is refused even while the phase is still submit', async () => {
    // The watcher may not have flipped the phase yet; the deadline alone closes
    // the round to replacements.
    const round4 = `${run}-0000-4000-8000-000000000007`;
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 3, 'submit', 100)",
      [round4, ids.room_id]
    );
    const r4 = { ...ids, round_id: round4 };
    await request(app)
      .post('/rpc/submission.create')
      .send(doc(r4, 'On time', `dl-${run}-1`))
      .expect(200);
    const late = await request(app)
      .post('/rpc/submission.create')
      .send(doc(r4, 'Too late', `dl-${run}-2`))
      .expect(409);
    expect(late.body.error).toBe('submission_closed');
  });

  it('a retry of a superseded nonce is refused instead of undoing the resubmission', async () => {
    const r2 = { ...ids, round_id: round2 };
    await request(app)
      .post('/rpc/submission.create')
      .send(doc(r2, 'A', `sup-${run}-1`))
      .expect(200);
    await request(app)
      .post('/rpc/submission.create')
      .send(doc(r2, 'B', `sup-${run}-2`))
      .expect(200);
    const retry = await request(app)
      .post('/rpc/submission.create')
      .send(doc(r2, 'A', `sup-${run}-1`))
      .expect(409);
    expect(retry.body.error).toBe('nonce_superseded');
    const row = await pool.query(
      'select content, version from submissions where round_id = $1 and author_id = $2',
      [round2, ids.author_id]
    );
    expect(row.rows).toEqual([{ content: 'B', version: 2 }]);
  });

  it('concurrent replacements each record the version they actually replaced', async () => {
    const upsert = (client, content, nonce) =>
      client.query(
        'select submission_upsert($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::text,$7::text) as id',
        [round2, other, content, '[]', '[]', sha(content), nonce]
      );
    await upsert(pool, `base-${run}`, `cc-${run}-0`);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('BEGIN');
      await upsert(c1, `first-${run}`, `cc-${run}-1`); // holds its change uncommitted
      const second = upsert(c2, `second-${run}`, `cc-${run}-2`);
      await new Promise((r) => setTimeout(r, 200));
      await c1.query('COMMIT');
      await second;
    } finally {
      // An open transaction must not go back to the pool: it would keep its
      // locks and swallow later queries on that connection.
      await c1.query('ROLLBACK').catch(() => {});
      c1.release();
      c2.release();
    }
    const audit = await pool.query(
      `select details->>'canonical_sha256' as sha, details->>'previous_sha256' as prev
         from admin_audit_log
        where entity_type = 'submission' and action = 'update'
          and entity_id = (select id from submissions where round_id = $1 and author_id = $2)
        order by created_at, id`,
      [round2, other]
    );
    expect(audit.rows).toEqual([
      { sha: sha(`first-${run}`), prev: sha(`base-${run}`) },
      { sha: sha(`second-${run}`), prev: sha(`first-${run}`) }
    ]);
  });

  it('a replacement that races the publish of its round waits for it and is refused', async () => {
    const round3 = `${run}-0000-4000-8000-000000000006`;
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 2, 'submit', 0)",
      [round3, ids.room_id]
    );
    const upsert = (client, content, nonce) =>
      client.query(
        'select submission_upsert($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::text,$7::text) as id',
        [round3, ids.author_id, content, '[]', '[]', sha(content), nonce]
      );
    await upsert(pool, `before-${run}`, `race-${run}-0`);
    const publisher = await pool.connect();
    const author = await pool.connect();
    try {
      // The watcher publishes in its own transaction, not yet committed.
      await publisher.query('BEGIN');
      await publisher.query("update rounds set phase = 'published' where id = $1", [round3]);
      const replacement = upsert(author, `after-${run}`, `race-${run}-1`).then(
        () => 'stored',
        (err) => err.message
      );
      await new Promise((r) => setTimeout(r, 200));
      await publisher.query('COMMIT');
      expect(await replacement).toBe('submission_closed');
    } finally {
      await publisher.query('ROLLBACK').catch(() => {});
      publisher.release();
      author.release();
    }
    const row = await pool.query('select content from submissions where round_id = $1', [round3]);
    expect(row.rows).toEqual([{ content: `before-${run}` }]);
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
      await db.query(await readFile(rpcPath, 'utf8'));
      await db.query('drop index submissions_one_per_author_round');
      await db.query(
        'alter table submissions add constraint submissions_round_id_author_id_client_nonce_key unique (round_id, author_id, client_nonce)'
      );
      await db.query('insert into rooms(id, title) values ($1, $2)', [ids.room_id, 'up']);
      await db.query("insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'submit')", [
        ids.round_id,
        ids.room_id
      ]);
      // A round already published: its submissions are in a signed journal.
      await db.query(
        "insert into rounds(id, room_id, idx, phase) values ($1, $2, 1, 'published')",
        [round2, ids.room_id]
      );
      await db.query(
        "insert into participants(id, room_id, anon_name, role) values ($1, $2, 'a1', 'debater'), ($3, $2, 'a2', 'debater')",
        [ids.author_id, ids.room_id, other]
      );
      await db.query(
        `insert into submissions (round_id, author_id, content, canonical_sha256, client_nonce, submitted_at) values
           ($1, $2, 'old', $4, 'n1', now() - interval '2 minutes'),
           ($1, $2, 'new', $5, 'n2', now() - interval '1 minute'),
           ($1, $3, 'only', $6, 'n3', now()),
           ($7, $2, 'pub-old', $8, 'p1', now() - interval '2 minutes'),
           ($7, $2, 'pub-new', $9, 'p2', now() - interval '1 minute')`,
        [
          ids.round_id,
          ids.author_id,
          other,
          sha('old'),
          sha('new'),
          sha('only'),
          round2,
          sha('pub-old'),
          sha('pub-new')
        ]
      );

      await db.query(schema);

      // Drafts in a round still in submit were never published: keep the newest.
      const draft = await db.query(
        'select author_id, content from submissions where round_id = $1 order by content',
        [ids.round_id]
      );
      expect(draft.rows).toEqual([
        { author_id: ids.author_id, content: 'new' },
        { author_id: other, content: 'only' }
      ]);
      // A published round keeps every row, so its transcript still matches the
      // journal that signed it; the older one is marked, not deleted.
      const published = await db.query(
        'select content, legacy_duplicate from submissions where round_id = $1 order by content',
        [round2]
      );
      expect(published.rows).toEqual([
        { content: 'pub-new', legacy_duplicate: false },
        { content: 'pub-old', legacy_duplicate: true }
      ]);
      const idx = await db.query(
        "select indexdef from pg_indexes where tablename = 'submissions' and indexname = 'submissions_one_per_author_round'"
      );
      expect(idx.rows[0].indexdef).toMatch(
        /\(round_id, author_id\) WHERE \(NOT legacy_duplicate\)/
      );
      const cons = await db.query(
        "select count(*)::int as n from pg_constraint where conrelid = 'submissions'::regclass and contype = 'u'"
      );
      expect(cons.rows[0].n).toBe(0);
      // The dropped draft's nonce is still known, so replaying it cannot
      // replace the newer draft that survived.
      await expect(
        db.query(
          'select submission_upsert($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::text,$7::text)',
          [ids.round_id, ids.author_id, 'old', '[]', '[]', sha('old'), 'n1']
        )
      ).rejects.toThrow(/nonce_superseded/);
    } finally {
      await db.end().catch(() => {});
      await admin.query(`drop database if exists ${name}`);
      await admin.end();
    }
  });
});

describe('one submission per participant per round (memory)', () => {
  beforeAll(() => __setDbPool(null));

  it('a retry of a superseded nonce is refused', async () => {
    const ids = {
      room_id: crypto.randomUUID(),
      round_id: crypto.randomUUID(),
      author_id: crypto.randomUUID()
    };
    await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'A', 'mem-sup-1'))
      .expect(200);
    await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'B', 'mem-sup-2'))
      .expect(200);
    const retry = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'A', 'mem-sup-1'))
      .expect(409);
    expect(retry.body.error).toBe('nonce_superseded');
  });

  it('room.create without a client_nonce makes a new room each time', async () => {
    // As in the database, where a missing nonce is NULL and never conflicts.
    const a = await request(app).post('/rpc/room.create').send({ topic: 'No nonce' }).expect(200);
    const b = await request(app).post('/rpc/room.create').send({ topic: 'No nonce' }).expect(200);
    expect(b.body.room_id).not.toBe(a.body.room_id);
  });

  it('a replacement after the round closes is refused in memory mode too', async () => {
    const created = await request(app)
      .post('/rpc/room.create')
      .send({ topic: 'Frozen in memory', cfg: { participant_count: 2, submit_minutes: 1 } })
      .expect(200);
    const room_id = created.body.room_id;
    const seats = (await request(app).get(`/rpc/room.get?room_id=${room_id}`)).body.participants;
    const round_id = (await request(app).get(`/state?room_id=${room_id}`)).body.round.round_id;
    const ids = { room_id, round_id, author_id: seats[0].id };
    const first = await request(app)
      .post('/rpc/submission.create')
      .send(doc(ids, 'Before', 'mem-frz-1'))
      .expect(200);
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000; // past the deadline; the round publishes
    try {
      await request(app).get(`/state?room_id=${room_id}`).expect(200);
      const late = await request(app)
        .post('/rpc/submission.create')
        .send(doc(ids, 'After', 'mem-frz-2'))
        .expect(409);
      expect(late.body.error).toBe('submission_closed');
      // An identical retry of the stored document is not a replacement: it is
      // answered with the same id, as submission_upsert answers it.
      const replay = await request(app)
        .post('/rpc/submission.create')
        .send(doc(ids, 'Before', 'mem-frz-1'))
        .expect(200);
      expect(replay.body.submission_id).toBe(first.body.submission_id);
      const state = (await request(app).get(`/state?room_id=${room_id}`)).body;
      expect(state.round.transcript.map((t) => t.content)).toEqual(['Before']);
    } finally {
      Date.now = realNow;
    }
  });

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
