import { atPath, parsePath } from '../claims/paths.js';
import { assertVerdictStore } from '../ports/VerdictStore.js';

/**
 * Verdict submission and claim-level aggregates.
 *
 * Persistence sits behind the VerdictStore port, so this class holds only the
 * rules that must be true whichever adapter is in use. It no longer knows that
 * Postgres exists, and it no longer branches on whether a pool is configured —
 * choosing an adapter is the composition root's job.
 */
export class VerificationService {
  constructor({ store }) {
    this.store = assertVerdictStore(store, 'VerificationService store');
  }

  /**
   * A path that parses is not a path that exists. The schema proves the syntax;
   * only the claim's own term can say whether the node is there, and binding a
   * verdict to a node is what the path is for.
   *
   * This is domain logic, above the port: server/claims/paths.js owns the path
   * grammar, and resolving inside each adapter would be two implementations
   * free to disagree. The store is asked only for the term.
   *
   * @throws {Error} claim_not_found     the claim_id names nothing in the submission
   * @throws {Error} claim_path_not_found the path names no node in that term
   */
  async assertPathResolves(store, input) {
    if (!input.claim_path) return;

    const term = await store.claimTerm(input.submission_id, input.claim_id);

    // No term means the claim_id names nothing here. Accepting the path anyway
    // files a verdict against a claim that does not exist, and the summary then
    // reports it as a finding.
    if (!term) throw new Error('claim_not_found');

    if (atPath(term, parsePath(input.claim_path)) === undefined) {
      throw new Error('claim_path_not_found');
    }
  }

  async submitVerdict(input) {
    // One store for the whole operation. Reading the term and writing the
    // verdict through separately-resolved delegates would let a pool swap
    // between them validate against one and persist through the other, and
    // verify_submit does not re-check the path.
    const store = this.store.forRequest?.() ?? this.store;
    await this.assertPathResolves(store, input);
    return store.submitVerdict(input);
  }

  async getSummary(roundId) {
    return this.store.summary(roundId);
  }
}
