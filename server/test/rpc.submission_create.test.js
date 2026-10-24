/* eslint-disable import/first */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
// Force in-memory path for this test to avoid DB coupling
const __origDbUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = '';
const app = (await import('../rpc.js')).default;
import { canonicalizeSorted, canonicalizeJCS, sha256Hex } from '../utils.js';

describe('POST /rpc/submission.create', () => {
  it('validates, canonicalizes, and is idempotent by client_nonce', async () => {
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: '00000000-0000-0000-0000-000000000003',
      phase: 'submit',
      deadline_unix: 0,
      content: 'Hello',
      claims: [
        {
          id: 'c1',
          term: {
            kind: 'claim',
            subject: { kind: 'named', name: 'claimant' },
            predicate: 'asserts',
            object: 'Abc'
          },
          support: [{ kind: 'logic', ref: 'r1' }]
        }
      ],
      citations: [{ url: 'https://example.com' }, { url: 'https://example.org' }],
      client_nonce: 'abc123456'
    };
    const canonicalizer =
      String(process.env.CANON_MODE || 'jcs').toLowerCase() === 'jcs'
        ? canonicalizeJCS
        : canonicalizeSorted;
    const canon = canonicalizer(body);
    const expected = sha256Hex(canon);
    const r1 = await request(app).post('/rpc/submission.create').send(body).expect(200);
    const r2 = await request(app).post('/rpc/submission.create').send(body).expect(200);
    expect(r1.body.ok).toBe(true);
    expect(r2.body.ok).toBe(true);
    expect(r1.body.submission_id).toEqual(r2.body.submission_id);
    expect(r1.body.canonical_sha256).toEqual(expected);
  });

  it('refuses a different document under a reused nonce (#236)', async () => {
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: '00000000-0000-0000-0000-000000000003',
      phase: 'submit',
      deadline_unix: 0,
      content: 'First draft: the claim is X.',
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
      citations: [{ url: 'https://example.com' }, { url: 'https://example.org' }],
      client_nonce: 'mem-nonce-reused-236'
    };
    const first = await request(app).post('/rpc/submission.create').send(body).expect(200);
    const edited = { ...body, content: 'Edited after seeing the room: the claim is Y.' };
    const second = await request(app).post('/rpc/submission.create').send(edited).expect(409);
    expect(second.body).toMatchObject({ ok: false, error: 'nonce_reused' });
    const replay = await request(app).post('/rpc/submission.create').send(body).expect(200);
    expect(replay.body.submission_id).toEqual(first.body.submission_id);
    expect(replay.body.canonical_sha256).toEqual(first.body.canonical_sha256);
  });
});

afterAll(() => {
  if (__origDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = __origDbUrl;
});
