import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';

const ROOM_ID = '00000000-0000-0000-0000-00000000f001';
const ROUND_ID = '00000000-0000-0000-0000-00000000f002';
const AUTHOR_ID = '00000000-0000-0000-0000-00000000f003';

describe('POST /rpc/submission.flag', () => {
  beforeAll(() => {
    __setDbPool(null);
  });

  it('allows flagging submissions and returns flag count (memory path)', async () => {
    const submission = {
      room_id: ROOM_ID,
      round_id: ROUND_ID,
      author_id: AUTHOR_ID,
      phase: 'OPENING',
      deadline_unix: 0,
      content: 'Test content',
      claims: [
        {
          id: 'c1',
          text: 'Claim',
          support: [{ kind: 'logic', ref: 'a' }]
        }
      ],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'nonce-flag-1'
    };

    const submissionRes = await request(app)
      .post('/rpc/submission.create')
      .send(submission)
      .expect(200);
    expect(submissionRes.body.ok).toBe(true);
    const submissionId = submissionRes.body.submission_id;
    expect(submissionId).toBeTruthy();

    const flagPayload = {
      submission_id: submissionId,
      reporter_id: '00000000-0000-0000-0000-00000000f010',
      reporter_role: 'participant',
      reason: 'inappropriate'
    };

    const flagRes = await request(app).post('/rpc/submission.flag').send(flagPayload);
    expect(flagRes.status).toBe(200);
    expect(flagRes.body.ok).toBe(true);
    expect(flagRes.body.flag_count).toBe(1);

    // duplicate flag from same reporter should not increment count
    const flagResDuplicate = await request(app)
      .post('/rpc/submission.flag')
      .send(flagPayload)
      .expect(200);
    expect(flagResDuplicate.body.ok).toBe(true);
    expect(flagResDuplicate.body.note).toBe('duplicate_flag');

    const flagResSecond = await request(app)
      .post('/rpc/submission.flag')
      .send({
        submission_id: submissionId,
        reporter_id: '00000000-0000-0000-0000-00000000f011',
        reporter_role: 'moderator'
      })
      .expect(200);
    expect(flagResSecond.body.flag_count).toBe(2);
  });

  it('returns error when submission is missing', async () => {
    const res = await request(app).post('/rpc/submission.flag').send({
      submission_id: '00000000-0000-0000-0000-00000000ffff',
      reporter_id: '00000000-0000-0000-0000-00000000aaaa',
      reporter_role: 'viewer'
    });
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('submission_not_found');
  });
});
