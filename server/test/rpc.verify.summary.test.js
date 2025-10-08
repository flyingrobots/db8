import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';

const ROOM_ID = '00000000-0000-0000-0000-00000000f101';
const ROUND_ID = '00000000-0000-0000-0000-00000000f102';
const AUTHOR_ID = '00000000-0000-0000-0000-00000000f103';
const RPT_A = '00000000-0000-0000-0000-00000000f104';
const RPT_B = '00000000-0000-0000-0000-00000000f105';

describe('GET /verify/summary (memory path)', () => {
  beforeAll(() => __setDbPool(null));

  it('aggregates per-submission and per-claim verdicts', async () => {
    const issued = await request(app)
      .post('/rpc/nonce.issue')
      .send({ round_id: ROUND_ID, author_id: AUTHOR_ID, ttl_sec: 60 })
      .then((r) => r.body)
      .catch(() => ({ ok: false }));

    const submission = {
      room_id: ROOM_ID,
      round_id: ROUND_ID,
      author_id: AUTHOR_ID,
      phase: 'submit',
      deadline_unix: 0,
      content: 'Target',
      claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'a' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: issued?.ok ? issued.nonce : 'nonce-sum-1'
    };
    const sres = await request(app).post('/rpc/submission.create').send(submission).expect(200);
    const sid = sres.body.submission_id;

    // Two reporters submit verdicts: overall and for claim c1
    await request(app)
      .post('/rpc/verify.submit')
      .send({
        round_id: ROUND_ID,
        reporter_id: RPT_A,
        submission_id: sid,
        verdict: 'true',
        client_nonce: 'sum-123456'
      })
      .expect(200);
    await request(app)
      .post('/rpc/verify.submit')
      .send({
        round_id: ROUND_ID,
        reporter_id: RPT_B,
        submission_id: sid,
        claim_id: 'c1',
        verdict: 'false',
        client_nonce: 'sum-234567'
      })
      .expect(200);

    const res = await request(app).get(`/verify/summary?round_id=${ROUND_ID}`).expect(200);
    expect(res.body.ok).toBe(true);
    const rows = res.body.rows || [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const overall = rows.find((r) => r.claim_id === null || r.claim_id === undefined);
    const claim = rows.find((r) => r.claim_id === 'c1');
    expect(overall?.true_count).toBe(1);
    expect(claim?.false_count).toBe(1);
  });
});
