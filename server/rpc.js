import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { rateLimitStub } from './mw/rate-limit.js';
import { SubmissionIn, ContinueVote, SubmissionFlag, RoomCreate } from './schemas.js';
import { canonicalizeSorted, canonicalizeJCS, sha256Hex } from './utils.js';
import { loadConfig } from './config/config-builder.js';
import { createSigner, buildJournalCore, finalizeJournal } from './journal.js';

const app = express();
const config = loadConfig();
const canonicalizer =
  config.canonMode?.toLowerCase?.() === 'jcs' ? canonicalizeJCS : canonicalizeSorted;
app.use(express.json());
app.use(rateLimitStub({ enforce: config.enforceRateLimit }));
// Serve static demo files (public/*) so you can preview UI in a browser
app.use(express.static('public'));

// Optional DB client (if DATABASE_URL provided)
let db = null;
if (config.databaseUrl) {
  try {
    db = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  } catch {
    db = null;
  }
}

export function __setDbPool(pool) {
  db = pool;
}

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// In-memory idempotency and submission store (M1 stub / fallback)
const memSubmissions = new Map(); // key -> { id, canonical_sha256, content, author_id, room_id }
const memSubmissionIndex = new Map(); // submission_id -> { room_id }
const memFlags = new Map(); // submission_id -> Map(reporter_id -> { role, reason, created_at })
// In-memory server-issued nonce stores (when DB is unavailable)
const memIssuedNonces = new Map(); // key "round:author" -> Set(nonce)
const memConsumedNonces = new Set(); // key "round:author:nonce"
// In-memory room state and idempotency for room.create fallback
const memRooms = new Map(); // room_id -> { round: { idx, phase, submit_deadline_unix, published_at_unix?, continue_vote_close_unix? } }
const memRoomNonces = new Map(); // client_nonce -> room_id
const SUBMIT_WINDOW_SEC = config.submitWindowSec;
const CONTINUE_WINDOW_SEC = config.continueWindowSec;
const signer = createSigner({
  privateKeyPem: process.env.SIGNING_PRIVATE_KEY || '',
  publicKeyPem: process.env.SIGNING_PUBLIC_KEY || '',
  canonMode: config.canonMode
});
const memJournalHashes = new Map();

// Server-issued nonce API (DB preferred)
app.post('/rpc/nonce.issue', async (req, res) => {
  try {
    const { round_id, author_id, ttl_sec } = req.body || {};
    if (!round_id || !author_id)
      return res.status(400).json({ ok: false, error: 'missing_round_or_author' });
    if (db) {
      try {
        const r = await db.query(
          'select submission_nonce_issue($1::uuid,$2::uuid,$3::int) as nonce',
          [round_id, author_id, Number(ttl_sec ?? 600) | 0]
        );
        const nonce = r.rows?.[0]?.nonce;
        if (!nonce) throw new Error('nonce_issue_no_value');
        return res.json({ ok: true, nonce });
      } catch {
        // Fall back to in-memory issuance if DB is unavailable
      }
    }
    const key = `${round_id}:${author_id}`;
    const s = memIssuedNonces.get(key) || new Set();
    const nonce = crypto.randomUUID();
    s.add(nonce);
    memIssuedNonces.set(key, s);
    return res.json({ ok: true, nonce, note: 'db_fallback' });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// submission.create
app.post('/rpc/submission.create', (req, res) => {
  try {
    const input = SubmissionIn.parse(req.body);
    // Optional server nonce enforcement when enabled
    if (!db && config.enforceServerNonces) {
      const issuedKey = `${input.round_id}:${input.author_id}`;
      const consumeKey = `${input.round_id}:${input.author_id}:${input.client_nonce}`;
      const issued = memIssuedNonces.get(issuedKey);
      if (!issued || !issued.has(input.client_nonce) || memConsumedNonces.has(consumeKey)) {
        return res.status(400).json({ ok: false, error: 'invalid_nonce' });
      }
      issued.delete(input.client_nonce);
      memConsumedNonces.add(consumeKey);
    }
    const canon = canonicalizer({
      room_id: input.room_id,
      round_id: input.round_id,
      author_id: input.author_id,
      phase: input.phase,
      deadline_unix: input.deadline_unix,
      content: input.content,
      claims: input.claims,
      citations: input.citations,
      client_nonce: input.client_nonce
    });
    const canonical_sha256 = sha256Hex(canon);
    // Enforce deadline if provided (> 0)
    const now = Math.floor(Date.now() / 1000);
    if (input.deadline_unix && input.deadline_unix > 0 && now > input.deadline_unix) {
      return res.status(400).json({ ok: false, error: 'deadline_passed' });
    }

    const key = `${input.room_id}:${input.round_id}:${input.author_id}:${input.client_nonce}`;
    if (db) {
      const pre = config.enforceServerNonces
        ? db.query('select submission_nonce_consume($1::uuid,$2::uuid,$3::text) as ok', [
            input.round_id,
            input.author_id,
            input.client_nonce
          ])
        : Promise.resolve();
      return pre
        .then(() =>
          db.query(
            'select submission_upsert($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::text,$7::text) as id',
            [
              input.round_id,
              input.author_id,
              input.content,
              JSON.stringify(input.claims),
              JSON.stringify(input.citations),
              canonical_sha256,
              input.client_nonce
            ]
          )
        )
        .then((r) => {
          const submission_id = r.rows?.[0]?.id;
          if (submission_id) {
            return res.json({ ok: true, submission_id, canonical_sha256 });
          }
          throw new Error('submission_upsert_missing_id');
        })
        .catch((e) => {
          if (config.enforceServerNonces) {
            // If DB path failed, attempt memory enforcement before falling back
            const issuedKey = `${input.round_id}:${input.author_id}`;
            const consumeKey = `${input.round_id}:${input.author_id}:${input.client_nonce}`;
            const issued = memIssuedNonces.get(issuedKey);
            if (!issued || !issued.has(input.client_nonce) || memConsumedNonces.has(consumeKey)) {
              return res.status(400).json({ ok: false, error: 'invalid_nonce' });
            }
            issued.delete(input.client_nonce);
            memConsumedNonces.add(consumeKey);
          }
          let submission_id;
          if (memSubmissions.has(key)) {
            submission_id = memSubmissions.get(key).id;
          } else {
            submission_id = crypto.randomUUID();
            memSubmissions.set(key, {
              id: submission_id,
              canonical_sha256,
              content: input.content,
              author_id: input.author_id,
              room_id: input.room_id
            });
            memSubmissionIndex.set(submission_id, { room_id: input.room_id });
          }
          return res.json({
            ok: true,
            submission_id,
            canonical_sha256,
            note: 'db_fallback',
            db_error: e.message
          });
        });
    }
    if (memSubmissions.has(key)) {
      const found = memSubmissions.get(key);
      return res.json({ ok: true, submission_id: found.id, canonical_sha256 });
    }
    const submission_id = crypto.randomUUID();
    memSubmissions.set(key, {
      id: submission_id,
      canonical_sha256,
      content: input.content,
      author_id: input.author_id,
      room_id: input.room_id
    });
    memSubmissionIndex.set(submission_id, { room_id: input.room_id });
    return res.json({ ok: true, submission_id, canonical_sha256 });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// In-memory vote idempotency store and tallies
const memVotes = new Map(); // key -> { id, choice }
const memVoteTotals = new Map(); // room_id -> { yes, no }

function addVoteToTotals(roomId, choice) {
  const key = String(roomId);
  const t = memVoteTotals.get(key) || { yes: 0, no: 0 };
  if (choice === 'continue') t.yes += 1;
  else t.no += 1;
  memVoteTotals.set(key, t);
}

// vote.continue
app.post('/rpc/vote.continue', (req, res) => {
  try {
    const input = ContinueVote.parse(req.body);
    const key = `${input.round_id}:${input.voter_id}:continue:${input.client_nonce}`;
    if (db) {
      return db
        .query('select vote_submit($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text) as id', [
          input.round_id,
          input.voter_id,
          'continue',
          JSON.stringify({ choice: input.choice }),
          input.client_nonce
        ])
        .then((r) => {
          const vote_id = r.rows?.[0]?.id;
          if (vote_id) {
            addVoteToTotals(input.room_id, input.choice);
            return res.json({ ok: true, vote_id });
          }
          throw new Error('vote_submit_missing_id');
        })
        .catch((e) => {
          if (memVotes.has(key))
            return res.json({
              ok: true,
              vote_id: memVotes.get(key).id,
              note: 'db_fallback',
              db_error: e.message
            });
          const vote_id = crypto.randomUUID();
          memVotes.set(key, { id: vote_id, choice: input.choice });
          addVoteToTotals(input.room_id, input.choice);
          return res.json({ ok: true, vote_id, note: 'db_fallback', db_error: e.message });
        });
    }
    if (memVotes.has(key)) return res.json({ ok: true, vote_id: memVotes.get(key).id });
    const vote_id = crypto.randomUUID();
    memVotes.set(key, { id: vote_id, choice: input.choice });
    addVoteToTotals(input.room_id, input.choice);
    return res.json({ ok: true, vote_id });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// room.create: seeds room + round 0 (DB) or in-memory fallback
app.post('/rpc/room.create', async (req, res) => {
  try {
    const input = RoomCreate.parse(req.body);
    const cfg = input.cfg || {};
    let dbError = null;
    if (db) {
      try {
        const result = await db.query(
          'select room_create($1::text,$2::jsonb,$3::text) as room_id',
          [input.topic, JSON.stringify(cfg), input.client_nonce || null]
        );
        const room_id = result.rows?.[0]?.room_id;
        if (!room_id) throw new Error('room_create_missing_id');
        return res.json({ ok: true, room_id });
      } catch (e) {
        dbError = e;
        console.warn('room.create DB error; using in-memory fallback', e);
        // fall through to memory path only if DB call fails
      }
    }
    // in-memory: generate a room id and initialize round 0
    const nonce = input.client_nonce ?? '';
    if (nonce && memRoomNonces.has(nonce)) {
      const existing = memRoomNonces.get(nonce);
      return res.json({
        ok: true,
        room_id: existing,
        note: 'db_fallback',
        db_error: dbError?.message || undefined
      });
    }
    const room_id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    memRooms.set(room_id, {
      round: { idx: 0, phase: 'submit', submit_deadline_unix: now + SUBMIT_WINDOW_SEC }
    });
    if (nonce) memRoomNonces.set(nonce, room_id);
    return res.json({
      ok: true,
      room_id,
      note: 'db_fallback',
      db_error: dbError?.message || undefined
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// submission.flag
app.post('/rpc/submission.flag', async (req, res) => {
  try {
    const input = SubmissionFlag.parse(req.body);
    const cleanReason = (input.reason || '').trim();
    if (db) {
      try {
        const result = await db.query(
          `with upsert as (
             insert into submission_flags (submission_id, reporter_id, reporter_role, reason)
             values ($1, $2, $3, $4)
             on conflict (submission_id, reporter_id)
             do update set reporter_role = excluded.reporter_role,
                           reason = excluded.reason,
                           created_at = now()
             returning submission_id
           )
           select submission_id,
                  (select count(*) from submission_flags where submission_id = $1) as flag_count
             from upsert`,
          [input.submission_id, input.reporter_id, input.reporter_role, cleanReason]
        );
        const count = Number(result.rows?.[0]?.flag_count || 0);
        return res.json({ ok: true, flag_count: count });
      } catch (e) {
        if (e?.code === '23503') {
          return res.status(404).json({ ok: false, error: 'submission_not_found' });
        }
        if (e?.code === '23505') {
          return res.status(200).json({ ok: true, note: 'duplicate_flag' });
        }
        // fall back to in-memory store if DB is unreachable or other errors occur
        const details =
          e?.message ||
          (Array.isArray(e?.errors) ? e.errors.map((err) => err.message).join('; ') : String(e));
        console.warn('submission.flag db error, falling back to memory', details);
      }
    }

    if (!memSubmissionIndex.has(input.submission_id)) {
      return res.status(404).json({ ok: false, error: 'submission_not_found' });
    }
    const existing = memFlags.get(input.submission_id) || new Map();
    const duplicate = existing.has(input.reporter_id);
    existing.set(input.reporter_id, {
      reporter_id: input.reporter_id,
      reporter_role: input.reporter_role,
      reason: cleanReason,
      created_at: Math.floor(Date.now() / 1000)
    });
    memFlags.set(input.submission_id, existing);
    const payload = { ok: true, flag_count: existing.size };
    if (duplicate) payload.note = 'duplicate_flag';
    return res.json(payload);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// In-memory room/round state and simple time-based transitions

function ensureRoom(roomId) {
  let r = memRooms.get(roomId);
  const now = Math.floor(Date.now() / 1000);
  const justCreated = !r;
  if (!r) {
    r = { round: { idx: 0, phase: 'submit', submit_deadline_unix: now + SUBMIT_WINDOW_SEC } };
    memRooms.set(roomId, r);
  }
  const round = r.round;
  // Simple phase transitions based on time windows (demo only)
  if (justCreated) return r; // avoid flipping in the same tick as creation
  if (round.phase === 'submit' && now > round.submit_deadline_unix) {
    round.phase = 'published';
    round.published_at_unix = now;
    round.continue_vote_close_unix = now + CONTINUE_WINDOW_SEC;
  } else if (
    round.phase === 'published' &&
    round.continue_vote_close_unix &&
    now > round.continue_vote_close_unix
  ) {
    const tally = memVoteTotals.get(String(roomId)) || { yes: 0, no: 0 };
    if (tally.yes > tally.no) {
      r.round = {
        idx: round.idx + 1,
        phase: 'submit',
        submit_deadline_unix: now + SUBMIT_WINDOW_SEC
      };
    } else {
      round.phase = 'final';
    }
  }
  return r;
}

// Authoritative state snapshot (enriched)
app.get('/state', async (req, res) => {
  const roomId = String(req.query.room_id || 'local');
  if (db) {
    try {
      const roundResult = await db.query(
        `select room_id, round_id, idx, phase, submit_deadline_unix,
                published_at_unix, continue_vote_close_unix
           from view_current_round
          where room_id = $1
          order by idx desc
          limit 1`,
        [roomId]
      );
      const roundRow = roundResult.rows?.[0];
      if (roundRow) {
        const [tallyResult, submissionsResult] = await Promise.all([
          db.query(
            'select yes, no from view_continue_tally where room_id = $1 and round_id = $2 limit 1',
            [roomId, roundRow.round_id]
          ),
          db.query(
            `select id,
                    author_id,
                    content,
                    canonical_sha256,
                    submitted_at,
                    flag_count,
                    flag_details
               from submissions_with_flags_view
              where round_id = $1
              order by submitted_at asc nulls last, id asc`,
            [roundRow.round_id]
          )
        ]);
        const tallyRow = tallyResult.rows?.[0] || { yes: 0, no: 0 };
        const transcript = submissionsResult.rows.map((row) => ({
          submission_id: row.id,
          author_id: row.author_id,
          content: row.content,
          canonical_sha256: row.canonical_sha256,
          submitted_at: row.submitted_at ? Math.floor(row.submitted_at.getTime() / 1000) : null,
          flag_count: Number(row.flag_count || 0),
          flags: Array.isArray(row.flag_details) ? row.flag_details : []
        }));
        const flagged = transcript
          .filter((entry) => entry.flag_count > 0)
          .map((entry) => ({ submission_id: entry.submission_id, flag_count: entry.flag_count }));
        return res.json({
          ok: true,
          room_id: roomId,
          round: {
            idx: roundRow.idx,
            phase: roundRow.phase,
            submit_deadline_unix: roundRow.submit_deadline_unix,
            published_at_unix: roundRow.published_at_unix,
            continue_vote_close_unix: roundRow.continue_vote_close_unix,
            continue_tally: {
              yes: Number(tallyRow.yes || 0),
              no: Number(tallyRow.no || 0)
            },
            transcript
          },
          flags: flagged
        });
      }
    } catch {
      // fall through to in-memory state on error
    }
  }
  const state = ensureRoom(roomId);
  const round = state.round;
  const tally = memVoteTotals.get(roomId) || { yes: 0, no: 0 };
  const transcript = Array.from(memSubmissions.entries())
    .filter(([key]) => key.startsWith(`${roomId}:`))
    .map(([, value]) => {
      const flags = memFlags.get(value.id);
      const flagEntries = flags
        ? Array.from(flags.entries()).map(([, detail]) => ({
            reporter_id: detail.reporter_id,
            reporter_role: detail.reporter_role,
            reason: detail.reason,
            created_at: detail.created_at
          }))
        : [];
      return {
        submission_id: value.id,
        author_id: value.author_id,
        content: value.content,
        canonical_sha256: value.canonical_sha256,
        submitted_at: null,
        flag_count: flagEntries.length,
        flags: flagEntries
      };
    });
  const flagged = transcript
    .filter((entry) => entry.flag_count > 0)
    .map((entry) => ({ submission_id: entry.submission_id, flag_count: entry.flag_count }));
  return res.json({
    ok: true,
    room_id: roomId,
    round: { ...round, continue_tally: tally, transcript },
    flags: flagged
  });
});

// SSE: timer events. Streams { t:'timer', room_id, ends_unix, round_idx, phase } every 1s.
app.get('/events', async (req, res) => {
  const roomId = String(req.query.room_id || 'local');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // If DB is configured, drive events from DB state + LISTEN/NOTIFY.
  let currentRound = null;
  let listenerClient = null;
  let closed = false;

  async function loadCurrentRound() {
    if (!db) return null;
    const r = await db.query(
      `select room_id, round_id, idx, phase, submit_deadline_unix,
              published_at_unix, continue_vote_close_unix
         from view_current_round
        where room_id = $1
        order by idx desc
        limit 1`,
      [roomId]
    );
    currentRound = r.rows?.[0] || null;
    return currentRound;
  }

  function endsUnixFromRound(roundRow) {
    const now = Math.floor(Date.now() / 1000);
    if (!roundRow) return now;
    if (roundRow.phase === 'submit' && roundRow.submit_deadline_unix)
      return Number(roundRow.submit_deadline_unix);
    if (roundRow.phase === 'published' && roundRow.continue_vote_close_unix)
      return Number(roundRow.continue_vote_close_unix);
    return now;
  }

  function sendTimer() {
    const now = Math.floor(Date.now() / 1000);
    const round = currentRound || ensureRoom(roomId).round;
    const payload = JSON.stringify({
      t: 'timer',
      room_id: roomId,
      ends_unix: endsUnixFromRound(currentRound) || now,
      round_idx: round.idx ?? currentRound?.idx ?? 0,
      phase: round.phase ?? currentRound?.phase ?? 'submit'
    });
    res.write(`event: timer\n`);
    res.write(`data: ${payload}\n\n`);
  }

  // Start timer tick now; DB listener will update currentRound and emit 'phase'.
  const iv = setInterval(() => {
    try {
      if (!closed) sendTimer();
    } catch {
      /* ignore */
    }
  }, 1000);

  try {
    if (db) {
      await loadCurrentRound();
      listenerClient = await db.connect();
      await listenerClient.query('LISTEN db8_rounds');
      const onNotification = (msg) => {
        if (msg.channel !== 'db8_rounds' || closed) return;
        try {
          const payload = JSON.parse(msg.payload || '{}');
          if (payload.room_id !== roomId) return;
          // Update cached round and emit a phase event immediately
          currentRound = {
            room_id: payload.room_id,
            round_id: payload.round_id,
            idx: payload.idx,
            phase: payload.phase,
            submit_deadline_unix: payload.submit_deadline_unix,
            published_at_unix: payload.published_at_unix,
            continue_vote_close_unix: payload.continue_vote_close_unix
          };
          res.write(`event: phase\n`);
          res.write(`data: ${JSON.stringify({ t: 'phase', ...currentRound })}\n\n`);
        } catch {
          // ignore bad payloads
        }
      };
      listenerClient.on('notification', onNotification);
      // Attach to underlying pg Client to get notifications
      listenerClient.connection?.stream?.on?.('error', () => {});

      // Ensure cleanup
      req.on('close', async () => {
        closed = true;
        clearInterval(iv);
        try {
          if (listenerClient) {
            listenerClient.removeListener('notification', onNotification);
            await listenerClient.query('UNLISTEN db8_rounds');
            listenerClient.release();
          }
        } catch {
          /* ignore */
        }
        res.end();
      });

      // send initial timer frame promptly
      sendTimer();
      return;
    }
  } catch {
    // If DB path fails, fall back to in-memory
  }

  // Fallback to in-memory authority when DB is unavailable
  req.on('close', () => {
    closed = true;
    clearInterval(iv);
    res.end();
  });
  sendTimer();
});

app.get('/journal', async (req, res) => {
  const roomId = String(req.query.room_id || 'local');
  try {
    let roundRow = null;
    let transcriptHashes = [];
    let tally = { yes: 0, no: 0 };
    if (db) {
      try {
        const r = await db.query(
          `select room_id, round_id, idx, phase, submit_deadline_unix,
                  published_at_unix, continue_vote_close_unix
             from view_current_round
            where room_id = $1
            order by idx desc
            limit 1`,
          [roomId]
        );
        roundRow = r.rows?.[0] || null;
        if (roundRow) {
          const [tallyResult, submissionsResult] = await Promise.all([
            db.query(
              'select yes, no from view_continue_tally where room_id = $1 and round_id = $2 limit 1',
              [roomId, roundRow.round_id]
            ),
            db.query(
              `select canonical_sha256 from submissions_with_flags_view where round_id = $1 order by submitted_at asc nulls last, id asc`,
              [roundRow.round_id]
            )
          ]);
          tally = tallyResult.rows?.[0] || { yes: 0, no: 0 };
          transcriptHashes = submissionsResult.rows.map((r) => String(r.canonical_sha256));
          // Load previous journal hash for chain linking
          const prevRow = await db
            .query('select hash from journals where room_id = $1 and round_idx = $2', [
              roomId,
              Number(roundRow.idx || 0) - 1
            ])
            .then((x) => x.rows?.[0]?.hash || null)
            .catch(() => null);
          // stash in locals
          roundRow._prev_hash = prevRow;
        }
      } catch {
        /* ignore */
      }
    }
    if (!roundRow) {
      const state = ensureRoom(roomId);
      const r = state.round;
      roundRow = {
        room_id: roomId,
        round_id: `mem-${roomId}-${r.idx}`,
        idx: r.idx,
        phase: r.phase,
        submit_deadline_unix: r.submit_deadline_unix,
        published_at_unix: r.published_at_unix,
        continue_vote_close_unix: r.continue_vote_close_unix
      };
      tally = memVoteTotals.get(roomId) || { yes: 0, no: 0 };
      transcriptHashes = Array.from(memSubmissions.entries())
        .filter(([key]) => key.startsWith(`${roomId}:`))
        .map(([, v]) => v.canonical_sha256);
    }
    const prev =
      roundRow._prev_hash || memJournalHashes.get(`${roomId}:${Number(roundRow.idx) - 1}`) || null;
    const core = buildJournalCore({
      room_id: roundRow.room_id,
      round_id: roundRow.round_id,
      idx: Number(roundRow.idx || 0),
      phase: roundRow.phase,
      submit_deadline_unix: roundRow.submit_deadline_unix,
      published_at_unix: roundRow.published_at_unix,
      continue_vote_close_unix: roundRow.continue_vote_close_unix,
      continue_tally: tally,
      transcript_hashes: transcriptHashes,
      prev_hash: prev
    });
    const journal = finalizeJournal({ core, signer });
    memJournalHashes.set(`${roomId}:${core.idx}`, journal.hash);
    return res.json({ ok: true, journal });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Journal history — returns stored journals (DB). Memory path returns latest only.
app.get('/journal/history', async (req, res) => {
  const roomId = String(req.query.room_id || 'local');
  try {
    if (db) {
      const r = await db.query(
        'select room_id, round_idx, hash, signature, core, created_at from journals where room_id = $1 order by round_idx asc',
        [roomId]
      );
      return res.json({ ok: true, journals: r.rows });
    }
    // Memory: synthesize latest from /journal
    const latest = await fetch(
      `http://localhost:${config.port}/journal?room_id=${encodeURIComponent(roomId)}`
    )
      .then((r) => r.json())
      .catch(() => null);
    if (latest?.ok) return res.json({ ok: true, journals: [latest.journal] });
    return res.json({ ok: true, journals: [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default app;

// If invoked directly, start server
if (config.nodeEnv !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const port = config.port;
  app.listen(port, () => console.error(`rpc listening on ${port}`));
}
