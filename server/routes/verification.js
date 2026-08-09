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
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
