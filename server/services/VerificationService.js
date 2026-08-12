import crypto from 'node:crypto';
import { atPath, parsePath } from '../claims/paths.js';

// A JSON tuple, not a delimiter-joined string. claim_id is an author-supplied
// value and may contain the delimiter: `source:claim` shifted every field after
// it when the key was split back apart, corrupting the summary rows.
function memKey(input) {
  return JSON.stringify([
    input.round_id,
    input.reporter_id,
    input.submission_id,
    input.claim_id ?? null,
    input.claim_path ?? null
  ]);
}

/**
 * VerificationService handles submission verdicts and claim-level aggregates.
 */
export class VerificationService {
  constructor({ dbRef, memVerifications, memSubmissionIndex }) {
    this.dbRef = dbRef;
    this.memVerifications = memVerifications;
    this.memSubmissionIndex = memSubmissionIndex;
  }

  get pool() {
    return this.dbRef.pool;
  }

  /**
   * A path that parses is not a path that exists. The schema proves the syntax;
   * only the claim's own term can say whether the node is there, and binding a
   * verdict to a node is what the column is for.
   *
   * Resolution stays here rather than in SQL because server/claims/paths.js owns
   * the grammar — a plpgsql copy would be a second implementation to drift.
   * @throws {Error} claim_path_not_found
   */
  async assertPathResolves(input) {
    if (!input.claim_path) return;

    let term;
    if (this.pool) {
      const r = await this.query('SELECT submission_claim_term($1::uuid,$2::text) AS term', [
        input.submission_id,
        input.claim_id
      ]);
      term = r.rows[0]?.term;
    } else {
      const claims = this.memSubmissionIndex?.get(input.submission_id)?.claims;
      term = claims?.find((c) => c?.id === input.claim_id)?.term;
    }

    // No term means the claim_id names nothing in this submission. Accepting the
    // path then files a verdict against a claim that does not exist, and the
    // summary reports it as a finding.
    if (!term) throw new Error('claim_not_found');

    if (atPath(term, parsePath(input.claim_path)) === undefined) {
      throw new Error('claim_path_not_found');
    }
  }

  /**
   * Every database call goes through here so a configured-but-failing database
   * fails the request instead of silently degrading to memory. A judge told
   * their verdict was recorded, when it was only held in a process that will
   * restart, has been misled about the one property verdicts need.
   *
   * Memory stays a first-class mode; it is chosen by configuration, not arrived
   * at by accident when a query errors.
   * @throws {Error} database_unavailable
   */
  async query(sql, params) {
    try {
      return await this.pool.query(sql, params);
    } catch (err) {
      console.error('[VerificationService] database error:', err.message);
      const wrapped = new Error('database_unavailable');
      wrapped.cause = err;
      throw wrapped;
    }
  }

  async submitVerdict(input) {
    await this.assertPathResolves(input);

    const key = memKey(input);

    if (this.pool) {
      const r = await this.query(
        'SELECT verify_submit($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text) AS id',
        [
          input.round_id,
          input.reporter_id,
          input.submission_id,
          input.claim_id,
          input.verdict,
          input.rationale,
          input.client_nonce,
          input.claim_path ?? null
        ]
      );
      return { id: r.rows[0].id };
    }

    if (this.memSubmissionIndex && !this.memSubmissionIndex.has(input.submission_id)) {
      throw new Error('submission_not_found');
    }

    if (this.memVerifications.has(key))
      return { id: this.memVerifications.get(key).id, note: 'db_fallback' };
    const id = crypto.randomUUID();
    this.memVerifications.set(key, { id, verdict: input.verdict, rationale: input.rationale });
    return { id, note: 'db_fallback' };
  }

  async getSummary(roundId) {
    if (this.pool) {
      const r = await this.query('SELECT * FROM verify_summary($1::uuid)', [roundId]);
      return r.rows;
    }

    // Memory Aggregation
    const summaryMap = new Map();
    for (const [key, v] of this.memVerifications.entries()) {
      const [round, , subId, claimId, claimPath] = JSON.parse(key);
      if (round !== roundId) continue;
      // Grouped by path, matching verify_summary. Without it this fallback
      // merges the two findings claim_path exists to separate, and the same
      // room reports differently depending on whether the database was up.
      const aggKey = JSON.stringify([subId, claimId, claimPath]);

      if (!summaryMap.has(aggKey)) {
        summaryMap.set(aggKey, {
          submission_id: subId,
          claim_id: claimId,
          claim_path: claimPath,
          true_count: 0,
          false_count: 0,
          unclear_count: 0,
          needs_work_count: 0,
          total: 0
        });
      }
      const entry = summaryMap.get(aggKey);
      entry.total++;
      if (v.verdict === 'true') entry.true_count++;
      else if (v.verdict === 'false') entry.false_count++;
      else if (v.verdict === 'unclear') entry.unclear_count++;
      else if (v.verdict === 'needs_work') entry.needs_work_count++;
    }

    return Array.from(summaryMap.values()).sort((a, b) => {
      if (a.submission_id !== b.submission_id)
        return a.submission_id.localeCompare(b.submission_id);
      if ((a.claim_id || '') !== (b.claim_id || ''))
        return (a.claim_id || '').localeCompare(b.claim_id || '');
      return (a.claim_path || '').localeCompare(b.claim_path || '');
    });
  }
}
