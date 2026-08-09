import express from 'express';

export function createJournalRouter({ db, buildLatestJournal }) {
  const router = express.Router();

  // /journal
  router.get('/journal', async (req, res) => {
    const roomId = String(req.query.room_id || 'local');
    const rawIdx = req.query.idx;
    const hasIdx = rawIdx !== undefined;

    // Validate at the edge rather than inside the database branch. Number('abc')
    // is NaN and Number('-1') is negative; both previously reached the query
    // unchecked and, finding nothing, fell through to the in-memory builder.
    let idx;
    if (hasIdx) {
      idx = Number(rawIdx);
      if (!Number.isInteger(idx) || idx < 0) {
        return res.status(400).json({ ok: false, error: 'invalid_idx' });
      }
    }

    try {
      if (db) {
        let queried = false;
        try {
          const q = hasIdx
            ? 'SELECT * FROM journals WHERE room_id = $1 AND round_idx = $2'
            : 'SELECT * FROM journals WHERE room_id = $1 ORDER BY round_idx DESC LIMIT 1';
          const r = await db.query(q, hasIdx ? [roomId, idx] : [roomId]);
          if (r.rows[0]) return res.json({ ok: true, journal: r.rows[0] });
          queried = true;
        } catch (dbErr) {
          console.error('[router] GET /journal DB error, falling back:', dbErr.message);
        }
        // The database answered and holds no such round. That is authoritative,
        // so do not consult the in-memory builder: it would answer a different
        // question than the caller asked.
        if (queried && hasIdx) {
          return res.status(404).json({ ok: false, error: 'journal_not_found' });
        }
      }

      const latest = await buildLatestJournal(roomId);
      // 404, not a 200 carrying ok:false — callers that branch on status code
      // otherwise read "no journal" as success.
      if (!latest) return res.status(404).json({ ok: false, error: 'journal_not_found' });
      // buildLatestJournal only ever produces the most recent round, and
      // RoomService auto-creates unknown rooms, so without this an indexed
      // request in memory mode is answered with a synthesized round 0.
      if (hasIdx && Number(latest?.core?.idx) !== idx) {
        return res.status(404).json({ ok: false, error: 'journal_not_found' });
      }
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
