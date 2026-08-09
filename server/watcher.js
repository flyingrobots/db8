import pg from 'pg';
import crypto from 'node:crypto';
import { log, getPersistentSigningKeys } from './utils.js';
import { createSigner } from './journal.js';
import { JournalService } from './services/JournalService.js';

// Authoritative round watcher.
// Invokes DB functions to flip rounds and relies on DB triggers + /events SSE for fanout.

let _interval = null;
let _pool = null;
let _journalService = null;
const WATCHER_ID = `watcher-${crypto.randomBytes(4).toString('hex')}`;
let _lastRecovery = 0;

export async function runTick(pool) {
  if (!pool) return;

  log.info('watcher tick', { watcher_id: WATCHER_ID });

  // M7: Signal liveness
  await pool.query('select orchestrator_heartbeat($1)', [WATCHER_ID]).catch((err) => {
    log.error('heartbeat failed', { error: err.message });
  });

  // M7: Periodically attempt recovery of abandoned barriers (every 30s)
  const now = Date.now();
  if (now - _lastRecovery > 30_000) {
    _lastRecovery = now;
    try {
      const r = await pool.query('select recover_abandoned_barrier(60)');
      if (r.rows?.[0]?.recover_abandoned_barrier > 0) {
        log.info('recovered abandoned barriers', { count: r.rows[0].recover_abandoned_barrier });
      }
    } catch (err) {
      log.error('recovery failed', { error: err.message });
    }
  }

  // Flip due submit→published, then open next rounds for winners
  await pool
    .query('select round_publish_due()')
    .catch((err) => log.error('publish_due failed', { error: err.message }));

  // Sign checkpoints for any newly-published rounds that don't have a journal row yet
  if (!_journalService) {
    _journalService = new JournalService({ pool, signer: _signer });
  }
  await _journalService
    .signUnsignedRounds()
    .catch((err) => log.error('journal signing failed', { error: err.message }));

  await pool
    .query('select round_open_next()')
    .catch((err) => log.error('open_next failed', { error: err.message }));
}

const _signer = createSigner({
  ...getPersistentSigningKeys(),
  canonMode: process.env.CANON_MODE || 'jcs'
});

export function startWatcher({ databaseUrl, intervalMs = 1000 } = {}) {
  if (!databaseUrl) return { stop: () => {} };
  _pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  _interval = setInterval(
    () => {
      runTick(_pool).catch(() => {});
    },
    Math.max(250, intervalMs)
  );
  return {
    stop: async () => {
      if (_interval) clearInterval(_interval);
      _interval = null;
      await _pool?.end?.();
      _pool = null;
      _journalService = null;
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL || '';
  const { stop } = startWatcher({ databaseUrl: url, intervalMs: 1000 });
  process.on('SIGINT', async () => {
    await stop();
    process.exit(0);
  });
}
