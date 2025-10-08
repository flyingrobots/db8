import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';

const ROOM_ID = '00000000-0000-0000-0000-00000000f001';
const ROUND_ID = '00000000-0000-0000-0000-00000000f002';
const AUTHOR_ID = '00000000-0000-0000-0000-00000000f003';
const REPORTER_ID = '00000000-0000-0000-0000-00000000f004';

describe('POST /rpc/verify.submit (memory path)', () => {
  beforeAll(() => {
    __setDbPool(null);
  });

  it('upserts a verdict idempotently by (round, reporter, submission, claim)', async () => {
    // Create a submission first
    // If server enforces issued nonces, obtain one for the author
    const issued = await request(app)
      .post('/rpc/nonce.issue')
      .send({ round_id: ROUND_ID, author_id: AUTHOR_ID, ttl_sec: 60 })
      .then((r) => r.body)
      .catch(() => ({ ok: false }));

    const sub = {
      room_id: ROOM_ID,
      round_id: ROUND_ID,
      author_id: AUTHOR_ID,
      phase: 'submit',
      deadline_unix: 0,
      content: 'Verification target',
      claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'a' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: issued?.ok ? issued.nonce : 'nonce-sub-ver-1'
    };
    const createRes = await request(app).post('/rpc/submission.create').send(sub);
    // Debug if failing in CI/local
    if (createRes.status !== 200) {
      console.error('submission.create failed', createRes.status, createRes.body);
    }
    expect(createRes.status).toBe(200);
    const submission_id = createRes.body.submission_id;

    const payload = {
      round_id: ROUND_ID,
      reporter_id: REPORTER_ID,
      submission_id,
      verdict: 'true',
      rationale: 'looks good',
      client_nonce: 'ver-123456'
    };
    const first = await request(app).post('/rpc/verify.submit').send(payload);
    if (first.status !== 200) {
      console.error('verify.submit first failed', first.status, first.body);
    }
    expect(first.status).toBe(200);
    const second = await request(app).post('/rpc/verify.submit').send(payload).expect(200);
    expect(first.body.ok).toBe(true);
    expect(second.body.id).toEqual(first.body.id);

    // Different claim should yield a different id
    const third = await request(app)
      .post('/rpc/verify.submit')
      .send({ ...payload, claim_id: 'c1', client_nonce: 'ver-234567' })
      .expect(200);
    expect(third.body.id).not.toEqual(first.body.id);
  });

  it('rejects invalid verdict enum', async () => {
    const res = await request(app).post('/rpc/verify.submit').send({
      round_id: ROUND_ID,
      reporter_id: REPORTER_ID,
      submission_id: '00000000-0000-0000-0000-00000000ffff',
      verdict: 'maybe',
      client_nonce: 'ver-bad'
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects malformed UUIDs and missing fields', async () => {
    const bad = await request(app).post('/rpc/verify.submit').send({ verdict: 'true' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const badIds = await request(app)
      .post('/rpc/verify.submit')
      .send({
        round_id: 'not-a-uuid',
        reporter_id: 'x',
        submission_id: 'y',
        verdict: 'true',
        client_nonce: 'v'
      });
    expect(badIds.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects non-existent submission_id', async () => {
    const res = await request(app).post('/rpc/verify.submit').send({
      round_id: ROUND_ID,
      reporter_id: REPORTER_ID,
      submission_id: '00000000-0000-0000-0000-00000000ffff',
      verdict: 'true',
      client_nonce: 'ver-missing'
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
