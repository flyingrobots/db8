import express from 'express';
import { ScoreSubmit, ScoreGet, ReputationGet } from '../schemas.js';

export function createScoringRouter({ scoringService, requireDbInProduction }) {
  const router = express.Router();

  // score.submit
  router.post('/rpc/score.submit', requireDbInProduction, async (req, res) => {
    try {
      const input = ScoreSubmit.parse(req.body);
      const result = await scoringService.submitScore(input);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[score.submit] error:', err);
      const msg = String(err?.message || '');
      if (/only judges/.test(msg)) return res.status(403).json({ ok: false, error: msg });
      return res.status(400).json({ ok: false, error: msg || String(err) });
    }
  });

  // scores.get
  router.get('/rpc/scores.get', async (req, res) => {
    try {
      const input = ScoreGet.parse(req.query);
      const rows = await scoringService.getScores(input.round_id);
      return res.json({ ok: true, rows });
    } catch (err) {
      console.error('[scores.get] error:', err);
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // reputation.get
  router.get('/rpc/reputation.get', async (req, res) => {
    try {
      const input = ReputationGet.parse(req.query);
      const elo = await scoringService.getReputation(input.participant_id, input.tag);
      return res.json({ ok: true, elo, tag: input.tag });
    } catch (err) {
      console.error('[reputation.get] error:', err);
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // reputation.update
  router.post('/rpc/reputation.update', requireDbInProduction, async (req, res) => {
    try {
      let roundId = req.body.round_id;
      const roomId = req.body.room_id;

      if (!roundId && roomId && scoringService.pool) {
        const r = await scoringService.pool.query(
          'SELECT round_id FROM view_current_round WHERE room_id = $1',
          [roomId]
        );
        roundId = r.rows[0]?.round_id;
      }

      if (!roundId) return res.status(400).json({ ok: false, error: 'missing_round_id' });
      await scoringService.updateReputations(roundId);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[reputation.update] error:', err);
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
