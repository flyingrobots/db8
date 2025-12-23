import express from 'express';

export function createJournalRouter({ db, buildLatestJournal }) {
  const router = express.Router();

  // /journal
  router.get('/journal', async (req, res) => {
    const roomId = String(req.query.room_id || 'local');
    const idx = req.query.idx;
    try {
      if (db) {
        try {
          const q =
            idx !== undefined
              ? 'SELECT * FROM journals WHERE room_id = $1 AND round_idx = $2'
              : 'SELECT * FROM journals WHERE room_id = $1 ORDER BY round_idx DESC LIMIT 1';
          const r = await db.query(q, idx !== undefined ? [roomId, Number(idx)] : [roomId]);
          if (r.rows[0]) return res.json({ ok: true, journal: r.rows[0] });
        } catch (dbErr) {
          console.error('[router] GET /journal DB error, falling back:', dbErr.message);
        }
      }
      const latest = await buildLatestJournal(roomId);
      if (!latest) return res.json({ ok: false, error: 'journal_not_found' });
      return res.json({ ok: true, journal: latest });
    } catch (err) {
      console.error('[router] GET /journal error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // /journal/history
  router.get('/journal/history', async (req, res) => {
    const roomId = String(req.query.room_id || 'local');
    try {
      if (db) {
        try {
          const r = await db.query(
            'SELECT * FROM journals WHERE room_id = $1 ORDER BY round_idx ASC',
            [roomId]
          );
          if (r.rows.length > 0) return res.json({ ok: true, journals: r.rows });
        } catch (dbErr) {
          console.error('[router] GET /journal/history DB error, falling back:', dbErr.message);
        }
      }
      const latest = await buildLatestJournal(roomId);
      return res.json({ ok: true, journals: latest ? [latest] : [] });
    } catch (err) {
      console.error('[router] GET /journal/history error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
