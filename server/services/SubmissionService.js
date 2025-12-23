import crypto from 'node:crypto';
import canonicalizer from '../canonicalizer.js';
import { sha256Hex } from '../utils.js';

/**
 * SubmissionService handles the business logic for debate submissions,
 * including canonicalization, hashing, and storage (DB vs Memory).
 */
export class SubmissionService {
  constructor({ db, config, memSubmissions, memSubmissionIndex, validateAndConsumeNonceMemory }) {
    this.db = db;
    this.config = config;
    this.memSubmissions = memSubmissions;
    this.memSubmissionIndex = memSubmissionIndex;
    this.validateAndConsumeNonceMemory = validateAndConsumeNonceMemory;
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

    const key = `${input.room_id}:${input.round_id}:${input.author_id}:${input.client_nonce}`;

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
        if (/invalid_nonce/i.test(msg)) throw new Error('invalid_nonce');

        // Log DB error and fall back to memory (except invalid_nonce handled above)
        console.error('[SubmissionService] DB error, falling back to memory:', msg);

        if (this.config.enforceServerNonces && !this.validateAndConsumeNonceMemory(input)) {
          throw new Error('invalid_nonce');
        }

        return this._createInMemory(key, input, canonical_sha256, msg);
      }
    }

    return this._createInMemory(key, input, canonical_sha256);
  }

  _createInMemory(key, input, canonical_sha256, dbError = null) {
    let submission_id;
    if (this.memSubmissions.has(key)) {
      submission_id = this.memSubmissions.get(key).id;
    } else {
      submission_id = crypto.randomUUID();
      this.memSubmissions.set(key, {
        id: submission_id,
        canonical_sha256,
        content: input.content,
        author_id: input.author_id,
        room_id: input.room_id
      });
      this.memSubmissionIndex.set(submission_id, { room_id: input.room_id });
    }

    return {
      submission_id,
      canonical_sha256,
      note: dbError ? 'db_fallback' : undefined,
      db_error: dbError || undefined
    };
  }
}
