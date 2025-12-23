import pg from 'pg';
import crypto from 'node:crypto';
import { log, getPersistentSigningKeys } from './utils.js';
import { createSigner, buildJournalCore, finalizeJournal } from './journal.js';

// Authoritative round watcher.
// Invokes DB functions to flip rounds and relies on DB triggers + /events SSE for fanout.

let _interval = null;
let _pool = null;
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
    await pool
      .query('select recover_abandoned_barrier(60)')
      .then((r) => {
        if (r.rows?.[0]?.recover_abandoned_barrier > 0) {
          log.info('recovered abandoned barriers', { count: r.rows[0].recover_abandoned_barrier });
        }
      })
      .catch((err) => {
        log.error('recovery failed', { error: err.message });
      });
  }

  // Flip due submit→published, then open next rounds for winners
  await pool
    .query('select round_publish_due()')
    .catch((err) => log.error('publish_due failed', { error: err.message }));
  // Sign checkpoints for any newly-published rounds that don't have a journal row yet
  await signPublished(pool);
  await pool
    .query('select round_open_next()')
    .catch((err) => log.error('open_next failed', { error: err.message }));
}

const _signer = createSigner({
  ...getPersistentSigningKeys(),
  canonMode: process.env.CANON_MODE || 'jcs'
});

async function signPublished(pool) {
  // Find published rounds without a journal row
  const q = `
    with pub as (
      select r.room_id, r.id as round_id, r.idx, r.phase, r.submit_deadline_unix, r.published_at_unix, r.continue_vote_close_unix
      from rounds_view r
      left join journals j on j.room_id = r.room_id and j.round_idx = r.idx
      where r.phase = 'published' and j.room_id is null
    )
    select p.*, coalesce(t.yes,0) as yes, coalesce(t.no,0) as no
    from pub p
    left join view_continue_tally t on t.room_id = p.room_id and t.round_id = p.round_id`;
  const { rows } = await pool.query(q);
  for (const row of rows) {
    // Look up previous journal hash for chain linking
    const prev = await pool
      .query('select hash from journals where room_id = $1 and round_idx = $2', [
        row.room_id,
        Number(row.idx || 0) - 1
      ])
      .then((r) => (r.rows?.[0]?.hash ? String(r.rows[0].hash) : null))
      .catch(() => null);
    // Fetch transcript hashes for the round
    const sub = await pool.query(
      `select canonical_sha256 from submissions_view where round_id = $1 order by submitted_at asc nulls last, id asc`,
      [row.round_id]
    );
    const hashes = sub.rows.map((r) => String(r.canonical_sha256));
    const core = buildJournalCore({
      room_id: row.room_id,
      round_id: row.round_id,
      idx: Number(row.idx || 0),
      phase: row.phase,
      submit_deadline_unix: row.submit_deadline_unix,
      published_at_unix: row.published_at_unix,
      continue_vote_close_unix: row.continue_vote_close_unix,
      continue_tally: { yes: Number(row.yes || 0), no: Number(row.no || 0) },
      transcript_hashes: hashes,
      prev_hash: prev
    });
    const j = finalizeJournal({ core, signer: _signer });
    await pool.query('select journal_upsert($1::uuid,$2::int,$3::text,$4::jsonb,$5::jsonb)', [
      row.room_id,
      Number(row.idx || 0),
      j.hash,
      j.signature,
      j.core
    ]);
  }
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
