import express from 'express';
import { rateLimitStub } from './mw/rate-limit.js';

const app = express();
app.use(express.json());
app.use(rateLimitStub());

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// Placeholder: submission.create
app.post('/rpc/submission.create', (req, res) => {
  // Zod validation will come later
  const { client_nonce } = req.body || {};
  if (!client_nonce) return res.status(400).json({ ok: false, error: 'client_nonce required' });
  return res.json({ ok: true, submission_id: 'TODO', canonical_sha256: 'TODO' });
});

// Placeholder: vote.continue
app.post('/rpc/vote.continue', (_req, res) => res.json({ ok: true }));

// Authoritative state snapshot (stub)
app.get('/state', (_req, res) => res.json({ ok: true, rounds: [], submissions: [] }));

export default app;

// If invoked directly, start server
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`rpc listening on ${port}`));
}
