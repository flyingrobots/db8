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
          // A specific round was asked for and the database does not have it.
          // Do not fall through to the in-memory builder below: that answers a
          // different question than the caller asked, handing back the latest
          // round to someone who requested round 999. Since RoomService
          // auto-creates unknown rooms in memory, the fallback would also
          // synthesize a journal for a room that has never existed.
          if (idx !== undefined) {
            return res.status(404).json({ ok: false, error: 'journal_not_found' });
          }
        } catch (dbErr) {
          console.error('[router] GET /journal DB error, falling back:', dbErr.message);
        }
      }
      const latest = await buildLatestJournal(roomId);
      // 404, not a 200 carrying ok:false — callers that branch on status code
      // otherwise read "no journal" as success.
      if (!latest) return res.status(404).json({ ok: false, error: 'journal_not_found' });
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
