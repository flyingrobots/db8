import pg from 'pg';

// Authoritative round watcher.
// Invokes DB functions to flip rounds and relies on DB triggers + /events SSE for fanout.

let _interval = null;
let _pool = null;

export async function runTick(pool) {
  if (!pool) return;
  // Flip due submit→published, then open next rounds for winners
  await pool.query('select round_publish_due()');
  await pool.query('select round_open_next()');
}

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
