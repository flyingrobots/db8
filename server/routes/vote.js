import express from 'express';
import { ContinueVote, FinalVote } from '../schemas.js';

export function createVoteRouter({ voteService, requireDbInProduction }) {
  const router = express.Router();

  // vote.continue
  router.post('/rpc/vote.continue', requireDbInProduction, async (req, res) => {
    try {
      const input = ContinueVote.parse(req.body);
      const result = await voteService.castContinueVote(input);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[vote.continue] error:', err);
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // vote.final
  router.post('/rpc/vote.final', requireDbInProduction, async (req, res) => {
    try {
      const input = FinalVote.parse(req.body);
      const result = await voteService.castFinalVote(input);
      return res.json({ ok: true, ...result });
    } catch (err) {
      const msg = String(err?.message || '');
      console.error('[vote.final] error:', err);
      if (/not a participant/.test(msg)) return res.status(403).json({ ok: false, error: msg });
      return res.status(400).json({ ok: false, error: msg || String(err) });
    }
  });

  return router;
}
