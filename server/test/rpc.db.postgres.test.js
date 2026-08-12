import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import app, { __setDbPool } from '../rpc.js';
import { canonicalizeSorted, canonicalizeJCS, sha256Hex } from '../utils.js';

const shouldRun = process.env.RUN_PGTAP === '1' || process.env.DB8_TEST_PG === '1';
const dbUrl =
  process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';

const suite = shouldRun ? describe : describe.skip;

suite('Postgres-backed RPC integration', () => {
  let pool;
  // Unique to this file: the 00000000-… space it used previously is shared by
  // nine other test files.
  const ROUND_ID = '0b8e0000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    __setDbPool(pool);

    // The database is prepared once by `npm run test:prepare-db` before the
    // suite runs. Re-applying db/schema.sql here re-ran its leading
    // `DROP TABLE IF EXISTS admin_audit_log CASCADE`, taking schema-wide
    // ACCESS EXCLUSIVE locks while sibling test files were mid-query — which
    // is what deadlocked the DB-gated suites, not the TRUNCATE below it.

    await pool.query(
      `insert into rooms (id, title)
       values ('0b8e0000-0000-0000-0000-000000000001', 'Local Demo Room')
       on conflict (id) do nothing`
    );
    await pool.query(
      `insert into rounds (id, room_id, idx, phase, submit_deadline_unix)
       values ('0b8e0000-0000-0000-0000-000000000002', '0b8e0000-0000-0000-0000-000000000001', 0, 'submit', 0)
       on conflict (id) do nothing`
    );
    await pool.query(
      `insert into participants (id, room_id, anon_name, role)
       values
         ('0b8e0000-0000-0000-0000-000000000003', '0b8e0000-0000-0000-0000-000000000001', 'pg-author', 'debater'),
         ('0b8e0000-0000-0000-0000-000000000004', '0b8e0000-0000-0000-0000-000000000001', 'pg-voter', 'debater')
       on conflict (id) do nothing`
    );
  });

  afterAll(async () => {
    __setDbPool(null);
    await pool?.end?.();
  });

  beforeEach(async () => {
    // Delete only this file's own rows, scoped by its round. The previous
    // TRUNCATE emptied submissions, votes and submission_flags outright —
    // shared tables that nine other test files write to — under an ACCESS
    // EXCLUSIVE lock, so it both deadlocked against and silently destroyed
    // their fixtures.
    await pool.query(
      'delete from submission_flags where submission_id in (select id from submissions where round_id = $1)',
      [ROUND_ID]
    );
    await pool.query('delete from submissions where round_id = $1', [ROUND_ID]);
    await pool.query('delete from votes where round_id = $1', [ROUND_ID]);
  });

  it('persists submissions through submission_upsert', async () => {
    const body = {
      room_id: '0b8e0000-0000-0000-0000-000000000001',
      round_id: '0b8e0000-0000-0000-0000-000000000002',
      author_id: '0b8e0000-0000-0000-0000-000000000003',
      phase: 'submit',
      deadline_unix: 0,
      content: 'Hello from pg',
      claims: [
        {
          id: 'c1',
          term: {
            kind: 'claim',
            subject: { kind: 'named', name: 'claimant' },
            predicate: 'asserts',
            object: 'Claim'
          },
          support: [{ kind: 'logic', ref: 'a' }]
        }
      ],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'pg-nonce-1234'
    };
    const canonicalizer =
      String(process.env.CANON_MODE || 'jcs').toLowerCase() === 'jcs'
        ? canonicalizeJCS
        : canonicalizeSorted;
    const canon = canonicalizer(body);
    const expectedHash = sha256Hex(canon);

    const first = await request(app).post('/rpc/submission.create').send(body).expect(200);
    const second = await request(app).post('/rpc/submission.create').send(body).expect(200);

    expect(first.body.ok).toBe(true);
    expect(first.body.canonical_sha256).toEqual(expectedHash);
    expect(second.body.submission_id).toEqual(first.body.submission_id);
    expect(first.body.note).toBeUndefined();

    const rows = await pool.query('select canonical_sha256 from submissions where id = $1', [
      first.body.submission_id
    ]);
    expect(rows.rows[0]?.canonical_sha256).toEqual(expectedHash);

    const state = await request(app).get(`/state?room_id=${body.room_id}`).expect(200);
    const transcriptEntry = state.body?.round?.transcript?.find(
      (t) => t.submission_id === first.body.submission_id
    );
    expect(transcriptEntry).toBeTruthy();
    expect(transcriptEntry?.canonical_sha256).toEqual(expectedHash);
  });

  it('persists continue votes through vote_submit', async () => {
    // Ensure round is in a voteable phase with an open window
    const now = Math.floor(Date.now() / 1000);
    await pool.query(
      `update rounds
          set phase='published',
              published_at_unix = $1::bigint,
              continue_vote_close_unix = $2::bigint
        where id = '0b8e0000-0000-0000-0000-000000000002'`,
      [now, now + 60]
    );
    const body = {
      room_id: '0b8e0000-0000-0000-0000-000000000001',
      round_id: '0b8e0000-0000-0000-0000-000000000002',
      voter_id: '0b8e0000-0000-0000-0000-000000000004',
      choice: 'continue',
      client_nonce: 'pg-vote-1234'
    };

    const first = await request(app).post('/rpc/vote.continue').send(body).expect(200);
    const second = await request(app).post('/rpc/vote.continue').send(body).expect(200);

    expect(first.body.ok).toBe(true);
    expect(second.body.vote_id).toEqual(first.body.vote_id);
    expect(first.body.note).toBeUndefined();

    const rows = await pool.query('select ballot from votes where id = $1', [first.body.vote_id]);
    const raw = rows.rows[0]?.ballot;
    const ballot = typeof raw === 'string' ? JSON.parse(raw) : raw;
    expect(ballot?.choice).toBe('continue');

    const state = await request(app).get(`/state?room_id=${body.room_id}`).expect(200);
    expect(state.body.round.continue_tally).toEqual({ yes: 1, no: 0 });
  });
});
