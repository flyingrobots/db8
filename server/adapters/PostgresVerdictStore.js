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
   * to answer from somewhere else — so an unreachable database surfaces as
   * `database_unavailable` rather than a normal empty result.
   *
   * But a rule the database *enforced* is not an outage. verify_submit raises
   * `round_not_verifiable` and `reporter_role_denied` deliberately; wrapping
   * those told the client the service was down when the database had answered
   * perfectly well and said no.
   *
   * Postgres sets `severity` on anything it replied with, whatever the
   * SQLSTATE. A connection that never got an answer has none.
   * @throws {Error} database_unavailable when the database could not be reached
   */
  async #query(sql, params) {
    try {
      return await this.pool.query(sql, params);
    } catch (err) {
      if (err?.severity) throw err;

      console.error('[PostgresVerdictStore] database unreachable:', err.message);
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
    // verify_submit is a scalar select, so one row is the expected shape. A
    // future signature returning setof or void would otherwise throw a raw
    // TypeError out of a method the port promises returns {id}.
    const id = r.rows[0]?.id;
    if (!id) throw new Error('verify_submit returned no id');
    return { id };
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
