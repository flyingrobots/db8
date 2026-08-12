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
  async assertPathResolves(input) {
    if (!input.claim_path) return;

    const term = await this.store.claimTerm(input.submission_id, input.claim_id);

    // No term means the claim_id names nothing here. Accepting the path anyway
    // files a verdict against a claim that does not exist, and the summary then
    // reports it as a finding.
    if (!term) throw new Error('claim_not_found');

    if (atPath(term, parsePath(input.claim_path)) === undefined) {
      throw new Error('claim_path_not_found');
    }
  }

  async submitVerdict(input) {
    await this.assertPathResolves(input);
    return this.store.submitVerdict(input);
  }

  async getSummary(roundId) {
    return this.store.summary(roundId);
  }
}
