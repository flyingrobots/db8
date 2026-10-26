import crypto from 'node:crypto';
import canonicalizer from '../canonicalizer.js';
import { sha256Hex } from '../utils.js';

/**
 * SubmissionService handles the business logic for debate submissions,
 * including canonicalization, hashing, and storage (DB vs Memory).
 */
export class SubmissionService {
  constructor({
    dbRef,
    config,
    memSubmissions,
    memSubmissionIndex,
    validateAndConsumeNonceMemory,
    memRooms = new Map()
  }) {
    this.memRooms = memRooms;
    this.dbRef = dbRef;
    this.config = config;
    this.memSubmissions = memSubmissions;
    this.memSubmissionIndex = memSubmissionIndex;
    this.validateAndConsumeNonceMemory = validateAndConsumeNonceMemory;
  }

  get db() {
    return this.dbRef.pool;
  }

  async create(input, { forceDlq = false } = {}) {
    if (forceDlq && this.db) {
      await this.db.query('select dlq_push($1::jsonb)', [JSON.stringify(input)]);
      throw new Error('forced_failure_queued');
    }

    // Optional server nonce enforcement when enabled
    if (!this.db && this.config.enforceServerNonces) {
      if (!this.validateAndConsumeNonceMemory(input)) {
        throw new Error('invalid_nonce');
      }
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
      throw new Error('deadline_passed');
    }

    // One submission per participant per round, as in the database (#237): a
    // resubmission replaces the stored one under the same id.
    const key = `${input.room_id}:${input.round_id}:${input.author_id}`;

    if (this.db) {
      try {
        // Use atomic RPC when enforcing server nonces; otherwise plain upsert
        const upsertSql = this.config.enforceServerNonces
          ? 'select submission_upsert_with_nonce($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::text,$7::text) as id'
          : 'select submission_upsert($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::text,$7::text) as id';

        const r = await this.db.query(upsertSql, [
          input.round_id,
          input.author_id,
          input.content,
          JSON.stringify(input.claims),
          JSON.stringify(input.citations),
          canonical_sha256,
          input.client_nonce
        ]);

        const submission_id = r.rows?.[0]?.id;
        if (!submission_id) throw new Error('submission_upsert_missing_id');

        return { submission_id, canonical_sha256 };
      } catch (e) {
        const msg = typeof e === 'string' ? e : e?.message || String(e) || 'db_error';
        if (/invalid_nonce/i.test(msg)) throw new Error('invalid_nonce', { cause: e });
        // Rules submission_upsert enforced (#237). Falling back to memory would
        // answer 200 for a document the database refused.
        if (msg === 'nonce_superseded' || msg === 'submission_closed' || msg === 'nonce_reused') {
          throw new Error(msg, { cause: e });
        }

        // Log DB error and fall back to memory (except invalid_nonce handled above)
        console.error('[SubmissionService] DB error, falling back to memory:', msg);

        if (this.config.enforceServerNonces && !this.validateAndConsumeNonceMemory(input)) {
          throw new Error('invalid_nonce', { cause: e });
        }

        return this._createInMemory(key, input, canonical_sha256, msg);
      }
    }

    // A configured database whose pool failed to initialize also lands here.
    // That is a fallback, so say so rather than presenting it as persisted.
    return this._createInMemory(
      key,
      input,
      canonical_sha256,
      this.dbRef.configured ? 'database_unavailable' : null
    );
  }

  // The memory room's own view of the round: a round it has moved past, or the
  // current one once it has left submit or its deadline has passed. Unknown
  // rooms (no memory room) cannot be judged and are left open.
  _memoryRoundClosed(roomId, roundId) {
    const room = this.memRooms.get(roomId);
    if (!room?.round) return false;
    if (room.publishedRounds?.has(roundId)) return true;
    if (room.round.round_id !== roundId) return false;
    if (room.round.phase !== 'submit') return true;
    const deadline = Number(room.round.submit_deadline_unix || 0);
    return deadline > 0 && Math.floor(Date.now() / 1000) > deadline;
  }

  _createInMemory(key, input, canonical_sha256, dbError = null) {
    const previous = this.memSubmissions.get(key);
    // As in the database: replaying a nonce a resubmission superseded would
    // undo the newer document, so it is refused.
    if (
      previous &&
      input.client_nonce !== previous.client_nonce &&
      previous.nonces?.has(input.client_nonce)
    ) {
      throw new Error('nonce_superseded');
    }
    // Replaying the stored nonce with the stored document changes nothing, so
    // it is answered with the same id even after the round closes, as
    // submission_upsert answers it before any closure check.
    if (
      previous &&
      previous.client_nonce === input.client_nonce &&
      previous.canonical_sha256 === canonical_sha256
    ) {
      return {
        submission_id: previous.id,
        canonical_sha256,
        note: dbError ? 'db_fallback' : undefined,
        db_error: dbError || undefined
      };
    }
    // The same nonce with a different document is refused, as submission_upsert
    // refuses it (#236).
    if (previous && previous.client_nonce === input.client_nonce) {
      throw new Error('nonce_reused');
    }
    if (previous && this._memoryRoundClosed(input.room_id, input.round_id)) {
      // As submission_upsert does: once the round has closed, the document is
      // frozen, because flags and verdicts stay attached to its id.
      throw new Error('submission_closed');
    }
    const submission_id = previous?.id ?? crypto.randomUUID();
    this.memSubmissions.set(key, {
      id: submission_id,
      canonical_sha256,
      content: input.content,
      author_id: input.author_id,
      room_id: input.room_id,
      round_id: input.round_id,
      client_nonce: input.client_nonce,
      nonces: new Set(previous?.nonces).add(input.client_nonce),
      version:
        previous &&
        (previous.client_nonce !== input.client_nonce ||
          previous.canonical_sha256 !== canonical_sha256)
          ? previous.version + 1
          : (previous?.version ?? 1)
    });
    // Claims are kept so the memory path can resolve a verdict's claim_path
    // the same way the database path does.
    this.memSubmissionIndex.set(submission_id, { room_id: input.room_id, claims: input.claims });

    return {
      submission_id,
      canonical_sha256,
      note: dbError ? 'db_fallback' : undefined,
      db_error: dbError || undefined
    };
  }
}
