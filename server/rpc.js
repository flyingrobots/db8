import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { rateLimitStub } from './mw/rate-limit.js';
import { log, getPersistentSigningKeys, LRUMap } from './utils.js';
import { loadConfig } from './config/config-builder.js';
import { createSigner, buildJournalCore, finalizeJournal } from './journal.js';

// Services
import { SubmissionService } from './services/SubmissionService.js';
import { AuthService } from './services/AuthService.js';
import { RoomService } from './services/RoomService.js';
import { VoteService } from './services/VoteService.js';
import { ScoringService } from './services/ScoringService.js';
import { VerificationService } from './services/VerificationService.js';

// Routers
import { createRoomRouter } from './routes/room.js';
import { createSubmissionRouter } from './routes/submission.js';
import { createVoteRouter } from './routes/vote.js';
import { createAuthRouter } from './routes/auth.js';
import { createJournalRouter } from './routes/journal.js';
import { createScoringRouter } from './routes/scoring.js';
import { createVerificationRouter } from './routes/verification.js';
import { createResearchRouter } from './routes/research.js';
import { createEventsRouter } from './routes/events.js';

const app = express();
const config = loadConfig();
app.use(express.json());
app.use(rateLimitStub({ enforce: true }));
app.use(express.static('public'));

// Global DB Ref to allow swapping (test support)
const dbRef = { pool: null };

if (config.databaseUrl) {
  try {
    dbRef.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  } catch (err) {
    log.error('DB pool initialization failed', { error: err.message });
    dbRef.pool = null;
  }
}

export function __setDbPool(pool) {
  dbRef.pool = pool;
}

function requireDbInProduction(req, res, next) {
  if (!dbRef.pool && process.env.NODE_ENV === 'production') {
    return res
      .status(503)
      .json({
        ok: false,
        error: 'service_unavailable',
        message: 'Database is required in production mode'
      });
  }
  next();
}

// Global state for in-memory fallbacks
const memSubmissions = new LRUMap(1000);
const memSubmissionIndex = new LRUMap(1000);
const memFlags = new LRUMap(1000);
const memVerifications = new LRUMap(2000);
const memRooms = new LRUMap(100);
const memRoomNonces = new LRUMap(500);
const memVotes = new LRUMap(1000);
const memVoteTotals = new LRUMap(100);
const memParticipantFingerprints = new LRUMap(1000);
const memAuthChallenges = new LRUMap(500);

// Initialize Services
const authService = new AuthService({
  dbRef,
  memAuthChallenges,
  memParticipantFingerprints,
  config
});
const roomService = new RoomService({
  dbRef,
  memRooms,
  memRoomNonces,
  memSubmissions,
  memFlags,
  memVoteTotals,
  config
});
const voteService = new VoteService({ dbRef, memVotes, memVoteTotals });
const scoringService = new ScoringService({ dbRef });
const verificationService = new VerificationService({
  dbRef,
  memVerifications,
  memSubmissionIndex
});

const memIssuedNonces = new LRUMap(5000); // For server-issued nonces in memory mode

function validateAndConsumeNonceMemory(input) {
  const { round_id, author_id, client_nonce } = input;
  // Use a key that matches how it was issued (round_id + author_id + nonce)
  const issueKey = `${round_id}:${author_id}:${client_nonce}`;
  const issued = memIssuedNonces.get(issueKey);

  if (issued) {
    const now = Date.now();
    if (now > issued.expiresAt) {
      memIssuedNonces.delete(issueKey);
      return false; // Expired
    }
    // Consume it
    memIssuedNonces.delete(issueKey);
    return true;
  }

  return false;
}

const submissionService = new SubmissionService({
  dbRef,
  config,
  memSubmissions,
  memSubmissionIndex,
  validateAndConsumeNonceMemory
});

// Helper for router mounting
const context = {
  authService,
  roomService,
  voteService,
  scoringService,
  verificationService,
  submissionService,
  rateLimitStub,
  requireDbInProduction,
  config,
  memFlags
};

// Mount Routers at Root
app.use(createRoomRouter(context));
app.use(createSubmissionRouter(context));
app.use(createVoteRouter(context));
app.use(createAuthRouter(context));
app.use(createScoringRouter(context));
app.use(createVerificationRouter(context));

const memResearchCache = new LRUMap(1000);
const memResearchQuotas = new LRUMap(1000);
app.use(
  createResearchRouter({
    get db() {
      return dbRef.pool;
    },
    requireDbInProduction,
    memResearchCache,
    memResearchQuotas
  })
);
app.use(
  createEventsRouter({
    get db() {
      return dbRef.pool;
    },
    roomService
  })
);

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// nonce.issue
app.post('/rpc/nonce.issue', requireDbInProduction, async (req, res) => {
  try {
    const round_id = req.body.round_id || req.body.room_id;
    const author_id = req.body.author_id;
    const ttl = req.body.ttl_sec || req.body.ttl || 300;

    if (!round_id || !author_id)
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    if (dbRef.pool) {
      const r = await dbRef.pool.query(
        'select submission_nonce_issue($1::uuid,$2::uuid,$3::int) as nonce',
        [round_id, author_id, ttl]
      );
      return res.json({ ok: true, nonce: r.rows[0].nonce });
    }

    // Memory fallback
    const nonce = crypto.randomUUID();
    const issueKey = `${round_id}:${author_id}:${nonce}`;
    memIssuedNonces.set(issueKey, { expiresAt: Date.now() + ttl * 1000 });

    return res.json({ ok: true, nonce, note: 'db_fallback' });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

const signer = createSigner({ ...getPersistentSigningKeys(), canonMode: config.canonMode });

async function buildLatestJournalWrapper(roomId) {
  const state = await roomService.getRoomState(roomId);
  if (!state.ok || !state.round) return null;
  const rnd = state.round;
  const core = buildJournalCore({
    room_id: roomId,
    round_id: rnd.round_id,
    idx: rnd.idx,
    phase: rnd.phase,
    submit_deadline_unix: rnd.submit_deadline_unix,
    published_at_unix: rnd.published_at_unix,
    continue_vote_close_unix: rnd.continue_vote_close_unix,
    continue_tally: rnd.continue_tally,
    transcript_hashes: (rnd.transcript || []).map((s) => s.canonical_sha256),
    prev_hash: null
  });
  return finalizeJournal({ core, signer });
}
app.use(
  createJournalRouter({
    get db() {
      return dbRef.pool;
    },
    buildLatestJournal: buildLatestJournalWrapper
  })
);

export default app;

if (config.nodeEnv !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(config.port, () => console.error(`rpc listening on ${config.port}`));
}
