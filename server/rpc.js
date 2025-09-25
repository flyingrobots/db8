import express from 'express';
import crypto from 'node:crypto';
import { rateLimitStub } from './mw/rate-limit.js';
import { SubmissionIn } from './schemas.js';
import { canonicalize, sha256Hex } from './utils.js';

const app = express();
app.use(express.json());
app.use(rateLimitStub());

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// In-memory idempotency and submission store (M1 stub)
const memSubmissions = new Map(); // key -> { id, canonical_sha256 }

// submission.create
app.post('/rpc/submission.create', (req, res) => {
  try {
    const input = SubmissionIn.parse(req.body);
    const canon = canonicalize({
      room_id: input.room_id,
      round_id: input.round_id,
      author_id: input.author_id,
      phase: input.phase,
      deadline_unix: input.deadline_unix,
      content: input.content,
      claims: input.claims,
      citations: input.citations,
      client_nonce: input.client_nonce
    });
    const canonical_sha256 = sha256Hex(canon);

    const key = `${input.room_id}:${input.round_id}:${input.author_id}:${input.client_nonce}`;
    if (memSubmissions.has(key)) {
      const found = memSubmissions.get(key);
      return res.json({ ok: true, submission_id: found.id, canonical_sha256 });
    }
    const submission_id = crypto.randomUUID();
    memSubmissions.set(key, { id: submission_id, canonical_sha256 });
    return res.json({ ok: true, submission_id, canonical_sha256 });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// Placeholder: vote.continue
app.post('/rpc/vote.continue', (_req, res) => res.json({ ok: true }));

// Authoritative state snapshot (stub)
app.get('/state', (_req, res) => res.json({ ok: true, rounds: [], submissions: [] }));

export default app;

// If invoked directly, start server
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.error(`rpc listening on ${port}`));
}
