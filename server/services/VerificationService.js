import crypto from 'node:crypto';

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

  async submitVerdict(input) {
    const key = `${input.round_id}:${input.reporter_id}:${input.submission_id}:${input.claim_id || 'none'}`;

    if (this.pool) {
      try {
        const r = await this.pool.query(
          'SELECT verify_submit($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text) AS id',
          [
            input.round_id,
            input.reporter_id,
            input.submission_id,
            input.claim_id,
            input.verdict,
            input.rationale,
            input.client_nonce
          ]
        );
        return { id: r.rows[0].id };
      } catch (err) {
        console.error('[VerificationService] DB error, falling back to memory:', err.message);
      }
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
      try {
        const r = await this.pool.query('SELECT * FROM verify_summary($1::uuid)', [roundId]);
        return r.rows;
      } catch (err) {
        console.error(
          '[VerificationService] DB error (getSummary), falling back to memory:',
          err.message
        );
      }
    }

    // Memory Aggregation
    const summaryMap = new Map();
    for (const [key, v] of this.memVerifications.entries()) {
      const parts = key.split(':');
      if (parts[0] !== roundId) continue;
      const subId = parts[2];
      const claimId = parts[3] === 'none' ? null : parts[3];
      const aggKey = `${subId}:${claimId || ''}`;

      if (!summaryMap.has(aggKey)) {
        summaryMap.set(aggKey, {
          submission_id: subId,
          claim_id: claimId,
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
      return (a.claim_id || '').localeCompare(b.claim_id || '');
    });
  }
}
