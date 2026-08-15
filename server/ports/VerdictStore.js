// The VerdictStore port.
//
// One contract, two adapters: Postgres for durable rooms, memory for rooms that
// were configured without a database. Memory is not a degraded mode reached by
// accident — it is chosen at composition, and both adapters answer the same
// questions the same way.
//
// This file is documentation and a conformance helper, not an abstract class.
// The contract is what the shared suite in server/test/verdict.store.contract.test.js
// asserts against every adapter; a base class would let an adapter inherit an
// implementation and silently skip that suite.
//
// What belongs behind this port: storing a verdict, reading the aggregate,
// reading back the term a verdict may target. What does *not*: deciding whether
// a claim path resolves. That is domain logic — server/claims/paths.js owns the
// grammar — and it lives above the port so both adapters cannot disagree.

/**
 * @typedef {object} VerdictInput
 * @property {string} round_id
 * @property {string} reporter_id
 * @property {string} submission_id
 * @property {string} [claim_id]      which claim within the submission
 * @property {string} [claim_path]    which node of that claim's term
 * @property {'true'|'false'|'unclear'|'needs_work'} verdict
 * @property {string} [rationale]
 * @property {string} client_nonce    idempotency token
 */

/**
 * @typedef {object} SummaryRow
 * @property {string} submission_id
 * @property {string|null} claim_id
 * @property {string|null} claim_path
 * @property {number} true_count
 * @property {number} false_count
 * @property {number} unclear_count
 * @property {number} needs_work_count
 * @property {number} total
 */

/**
 * @typedef {object} VerdictStore
 *
 * @property {(input: VerdictInput) => Promise<{id: string, note?: string}>} submitVerdict
 *   Records a verdict and returns its id. Idempotent on
 *   (round, reporter, submission, claim, path, nonce): submitting the same
 *   tuple twice returns the same id rather than a second row. A verdict on the
 *   attribution and a verdict on the proposition it attributes are *different*
 *   findings, so the path is part of that identity — and so is the nonce, which
 *   is what separates a repeat from a revision.
 *
 *   Rejects a verdict value outside the four listed above.
 *
 *   KNOWN DIVERGENCE, not yet resolved: the adapters name the unknown-submission
 *   rejection differently. Memory raises `submission_not_found`. Postgres raises
 *   `submission_round_mismatch`, and does so both when the submission does not
 *   exist and when it belongs to another round, because verify_submit checks the
 *   pair in one statement. Aligning them means renaming a client-facing error,
 *   which is a product decision rather than a refactor, so the contract suite
 *   deliberately does not assert a name here.
 *
 * @property {(roundId: string) => Promise<SummaryRow[]>} summary
 *   Verdict counts for a round, one row per (submission, claim, path), ordered
 *   by those three. Grouping must include the path or the two findings the path
 *   exists to separate are merged back together.
 *
 * @property {(submissionId: string, claimId: string) => Promise<object|undefined>} claimTerm
 *   The stored term of one claim, or undefined when the submission has no claim
 *   with that id. Callers use it to check that a verdict's path names a real
 *   node; the store itself does not resolve paths.
 */

/** The methods every adapter must provide. Used by the contract suite. */
export const VERDICT_STORE_METHODS = Object.freeze(['submitVerdict', 'summary', 'claimTerm']);

/**
 * Throws when an object does not present the port's surface. Cheap guard for
 * the composition root, so a missing method fails at wiring rather than on the
 * first request that happens to need it.
 * @param {object} store
 * @param {string} label
 */
export function assertVerdictStore(store, label = 'store') {
  for (const method of VERDICT_STORE_METHODS) {
    if (typeof store?.[method] !== 'function') {
      throw new Error(`${label} does not implement VerdictStore.${method}`);
    }
  }
  return store;
}
