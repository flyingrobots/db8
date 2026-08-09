import express from 'express';
import crypto from 'node:crypto';
import { ResearchFetch, ResearchCacheGet } from '../schemas.js';

export function createResearchRouter({
  db,
  requireDbInProduction,
  memResearchCache,
  memResearchQuotas
}) {
  const router = express.Router();

  // research.fetch
  router.post('/rpc/research.fetch', requireDbInProduction, async (req, res) => {
    try {
      const input = ResearchFetch.parse(req.body);
      if (db) {
        try {
          // 1. Check/Increment usage
          // We need max fetches from room config
          const roomRes = await db.query('SELECT config FROM rooms WHERE id = $1', [input.room_id]);
          const max = Number(roomRes.rows[0]?.config?.max_fetches_per_round || 0);

          await db.query('SELECT research_usage_increment($1,$2,$3)', [
            input.room_id,
            input.round_id,
            max
          ]);

          // 2. Check cache
          const cacheRes = await db.query('SELECT snapshot FROM research_cache WHERE url = $1', [
            input.url
          ]);
          if (cacheRes.rows[0]) {
            return res.json({ ok: true, snapshot: cacheRes.rows[0].snapshot, cached: true });
          }

          // 3. Perform "fetch" (stubbed for now as in memory path)
          const snapshot = {
            url: input.url,
            title: 'Snapshot',
            content: '...',
            created_at: new Date().toISOString()
          };
          const urlHash = crypto.createHash('sha256').update(input.url).digest('hex');
          await db.query('SELECT research_cache_upsert($1,$2,$3)', [
            input.url,
            urlHash,
            JSON.stringify(snapshot)
          ]);

          return res.json({ ok: true, snapshot, cached: false });
        } catch (e) {
          if (/quota_exceeded/.test(e.message))
            return res.status(429).json({ ok: false, error: 'quota_exceeded' });
          throw e;
        }
      }

      // Memory fallback
      const roundId = input.round_id || 'default';
      const quota = memResearchQuotas.get(roundId) || 0;
      if (quota >= 10) return res.status(429).json({ ok: false, error: 'quota_exceeded' });

      const id = crypto.randomUUID();
      memResearchQuotas.set(roundId, quota + 1);
      const snapshot = {
        url: input.url,
        title: 'Snapshot',
        content: '...',
        created_at: new Date().toISOString()
      };
      memResearchCache.set(input.url, snapshot);

      return res.json({ ok: true, id, snapshot, cached: false, note: 'db_fallback' });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // research.cache
  router.get('/rpc/research.cache', async (req, res) => {
    try {
      const input = ResearchCacheGet.parse(req.query);
      if (db) {
        const r = await db.query('SELECT snapshot FROM research_cache WHERE url = $1', [input.url]);
        if (r.rows[0]) return res.json({ ok: true, snapshot: r.rows[0].snapshot });
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      const data = memResearchCache.get(input.url);
      if (data) return res.json({ ok: true, snapshot: data });
      return res.status(404).json({ ok: false, error: 'not_found' });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
