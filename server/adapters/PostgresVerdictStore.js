/**
 * VerdictStore backed by Postgres.
 *
 * Every statement it issues is an RPC — verify_submit, verify_summary,
 * submission_claim_term — so the invariants live in db/rpc.sql where any client
 * reaching the database gets them, not only this process.
 *
 * The pool is read from a mutable holder rather than captured, because
 * server/rpc.js swaps it at runtime (__setDbPool) and a captured reference
 * would keep using a pool that has been replaced.
 */
export class PostgresVerdictStore {
  constructor({ dbRef }) {
    this.dbRef = dbRef;
  }

  get pool() {
    return this.dbRef.pool;
  }

  /**
   * A configured database that fails is a durability failure, not an invitation
   * to answer from somewhere else. Every query goes through here so the failure
   * is named once and cannot be mistaken for a normal empty result.
   * @throws {Error} database_unavailable
   */
  async #query(sql, params) {
    try {
      return await this.pool.query(sql, params);
    } catch (err) {
      console.error('[PostgresVerdictStore] database error:', err.message);
      const wrapped = new Error('database_unavailable');
      wrapped.cause = err;
      throw wrapped;
    }
  }

  async submitVerdict(input) {
    const r = await this.#query(
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

  async summary(roundId) {
    const r = await this.#query('SELECT * FROM verify_summary($1::uuid)', [roundId]);
    return r.rows;
  }

  async claimTerm(submissionId, claimId) {
    const r = await this.#query('SELECT submission_claim_term($1::uuid,$2::text) AS term', [
      submissionId,
      claimId
    ]);
    return r.rows[0]?.term ?? undefined;
  }
}
