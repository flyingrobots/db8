import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app, { __setDbPool } from '../rpc.js';

class FakePool {
  constructor() {
    this.submissions = new Map();
    this.hashes = new Map();
    this.votes = new Map();
    this.calls = [];
  }

  async query(text, params) {
    this.calls.push({ text, params });
    if (text.includes('submission_upsert')) {
      const [roundId, authorId, _content, _claims, _citations, canonicalSha, clientNonce] = params;
      const key = `${roundId}:${authorId}:${clientNonce}`;
      if (!this.submissions.has(key)) {
        this.submissions.set(key, randomUUID());
      }
      const id = this.submissions.get(key);
      this.hashes.set(id, canonicalSha);
      return { rows: [{ id }] };
    }
    if (text.includes('vote_submit')) {
      const [roundId, voterId, _kind, _ballotJson, clientNonce] = params;
      const key = `${roundId}:${voterId}:${clientNonce}`;
      if (!this.votes.has(key)) {
        this.votes.set(key, randomUUID());
      }
      const id = this.votes.get(key);
      return { rows: [{ id }] };
    }
    throw new Error(`Unexpected query: ${text}`);
  }

  async end() {}
}

let pool;

beforeEach(() => {
  pool = new FakePool();
  __setDbPool(pool);
});

afterEach(async () => {
  await pool.end();
  __setDbPool(null);
});

describe('DB-backed RPC integration (stubbed pool)', () => {
  it('uses submission_upsert and preserves idempotency', async () => {
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: '00000000-0000-0000-0000-000000000003',
      phase: 'OPENING',
      deadline_unix: 0,
      content: 'Hello world',
      claims: [{ id: 'c1', text: 'Claim', support: [{ kind: 'logic', ref: 'a' }] }],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'nonce-1234'
    };

    const first = await request(app).post('/rpc/submission.create').send(body).expect(200);
    const second = await request(app).post('/rpc/submission.create').send(body).expect(200);

    expect(first.body.ok).toBe(true);
    expect(second.body.submission_id).toEqual(first.body.submission_id);
    expect(pool.calls[0].text).toContain('submission_upsert');
    expect(pool.hashes.get(first.body.submission_id)).toEqual(first.body.canonical_sha256);
  });

  it('uses vote_submit for continue votes', async () => {
    const body = {
      room_id: '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      voter_id: '00000000-0000-0000-0000-000000000004',
      choice: 'continue',
      client_nonce: 'vote-1234'
    };

    const first = await request(app).post('/rpc/vote.continue').send(body).expect(200);
    const second = await request(app).post('/rpc/vote.continue').send(body).expect(200);

    expect(first.body.ok).toBe(true);
    expect(second.body.vote_id).toEqual(first.body.vote_id);
    const voteCalls = pool.calls.filter((c) => c.text.includes('vote_submit'));
    expect(voteCalls.length).toBeGreaterThan(0);
  });
});
