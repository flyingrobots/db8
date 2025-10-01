import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import app, { __setDbPool } from '../rpc.js';
import { canonicalize, sha256Hex } from '../utils.js';

const shouldRun = process.env.RUN_PGTAP === '1' || process.env.DB8_TEST_PG === '1';
const dbUrl = process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8';

const suite = shouldRun ? describe : describe.skip;

suite('Postgres-backed RPC integration', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    __setDbPool(pool);

    const schemaSql = fs.readFileSync(path.resolve('db/schema.sql'), 'utf8');
    const rpcSql = fs.readFileSync(path.resolve('db/rpc.sql'), 'utf8');
    await pool.query(schemaSql);
    await pool.query(rpcSql);

    await pool.query(
      `insert into rooms (id, title)
       values ('00000000-0000-0000-0000-000000000001', 'Local Demo Room')
       on conflict (id) do nothing`
    );
    await pool.query(
      `insert into rounds (id, room_id, idx, phase, submit_deadline_unix)
       values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 0, 'submit', 0)
       on conflict (id) do nothing`
    );
    await pool.query(
      `insert into participants (id, room_id, anon_name, role)
       values
         ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'pg-author', 'debater'),
         ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'pg-voter', 'debater')
       on conflict (id) do nothing`
    );
  });

  afterAll(async () => {
    __setDbPool(null);
    await pool?.end?.();
  });

  beforeEach(async () => {
    const tables = ['submission_flags', 'submissions', 'votes'];
    const existing = [];
    for (const table of tables) {
      const res = await pool.query('select to_regclass($1) as reg', [`public.${table}`]);
      if (res.rows[0]?.reg) existing.push(`"public"."${table}"`);
    }
    if (existing.length > 0) {
      await pool.query(`TRUNCATE ${existing.join(', ')} RESTART IDENTITY CASCADE;`);
    }
  });

  it('persists submissions through submission_upsert', async () => {
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: '00000000-0000-0000-0000-000000000003',
      phase: 'submit',
      deadline_unix: 0,
      content: 'Hello from pg',
      claims: [{ id: 'c1', text: 'Claim', support: [{ kind: 'logic', ref: 'a' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'pg-nonce-1234'
    };
    const canon = canonicalize(body);
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
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      voter_id: '00000000-0000-0000-0000-000000000004',
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
