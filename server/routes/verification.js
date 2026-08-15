import express from 'express';
import { VerifySubmit } from '../schemas.js';

export function createVerificationRouter({ verificationService, requireDbInProduction }) {
  const router = express.Router();

  // verify.submit
  router.post('/rpc/verify.submit', requireDbInProduction, async (req, res) => {
    try {
      const input = VerifySubmit.parse(req.body);
      const result = await verificationService.submitVerdict(input);
      return res.json({ ok: true, ...result });
    } catch (err) {
      // A configured database that failed is not the caller's fault, and the
      // verdict was not recorded. 503 says both.
      if (err?.message === 'database_unavailable' || err?.message === 'verdict_capacity_reached')
        return res.status(503).json({ ok: false, error: err.message });
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // verify/summary
  router.get('/verify/summary', async (req, res) => {
    try {
      const roundId = String(req.query.round_id);
      const rows = await verificationService.getSummary(roundId);
      return res.json({ ok: true, rows });
    } catch (err) {
      if (err?.message === 'database_unavailable')
        return res.status(503).json({ ok: false, error: err.message });
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
