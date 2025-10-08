import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import app, { __setDbPool } from '../rpc.js';

const shouldRun = process.env.RUN_PGTAP === '1' || process.env.DB8_TEST_PG === '1';
const dbUrl =
  process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';

const suite = shouldRun ? describe : describe.skip;

suite('Postgres-backed verification RPCs', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    __setDbPool(pool);

    const schemaSql = fs.readFileSync(path.resolve('db/schema.sql'), 'utf8');
    const rpcSql = fs.readFileSync(path.resolve('db/rpc.sql'), 'utf8');
    const rlsSql = fs.readFileSync(path.resolve('db/rls.sql'), 'utf8');
    await pool.query(schemaSql);
    await pool.query(rpcSql);
    await pool.query(rlsSql);

    await pool.query(
      `insert into rooms (id, title)
       values ('30000000-0000-0000-0000-000000000001', 'Verify Room PG')
       on conflict (id) do nothing`
    );
    await pool.query(
      `insert into rounds (id, room_id, idx, phase, submit_deadline_unix, published_at_unix)
       values ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 0, 'published', 0, extract(epoch from now())::bigint)
       on conflict (id) do nothing`
    );
    await pool.query(
      `insert into participants (id, room_id, anon_name, role)
       values
         ('30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'author', 'debater'),
         ('30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', 'judge', 'judge')
       on conflict (id) do nothing`
    );
  });

  afterAll(async () => {
    __setDbPool(null);
    await pool?.end?.();
  });

  beforeEach(async () => {
    const tables = ['verification_verdicts', 'submissions'];
    const existing = [];
    for (const table of tables) {
      const res = await pool.query('select to_regclass($1) as reg', [`public.${table}`]);
      if (res.rows[0]?.reg) existing.push(`"public"."${table}"`);
    }
    if (existing.length > 0) {
      await pool.query(`TRUNCATE ${existing.join(', ')} RESTART IDENTITY CASCADE;`);
    }
  });

  it('verify_submit stores and verify_summary aggregates', async () => {
    // Seed a submission
    const sub = await pool.query(
      `insert into submissions (round_id, author_id, content, canonical_sha256, client_nonce)
       values ('30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','Hello','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','nonce')
       returning id`
    );
    const submission_id = sub.rows[0].id;

    const body = {
      round_id: '30000000-0000-0000-0000-000000000002',
      reporter_id: '30000000-0000-0000-0000-000000000004',
      submission_id,
      verdict: 'true',
      client_nonce: 'pg-ver-1'
    };
    const first = await request(app).post('/rpc/verify.submit').send(body).expect(200);
    const second = await request(app).post('/rpc/verify.submit').send(body).expect(200);
    expect(second.body.id).toEqual(first.body.id);

    const summary = await request(app)
      .get('/verify/summary?round_id=30000000-0000-0000-0000-000000000002')
      .expect(200);
    const rows = summary.body.rows || [];
    const overall = rows.find((r) => r.claim_id === null || r.claim_id === undefined);
    expect(overall?.true_count).toBe(1);
  });
});
