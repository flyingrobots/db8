import crypto from 'node:crypto';

// A JSON tuple, not a delimiter-joined string. claim_id is author-supplied and
// may contain the delimiter: "source:claim" shifted every field after it when
// the key was split back apart, corrupting the summary rows.
// The nonce is part of the identity, matching verify_submit's ON CONFLICT and
// the rule the port states. It is what separates a repeat from a revision: a
// judge who reconsiders resends the same tuple with a new nonce, and dropping it
// returned the original id and discarded the revised ruling.
function verdictKey(input) {
  return JSON.stringify([
    input.round_id,
    input.reporter_id,
    input.submission_id,
    input.claim_id ?? null,
    input.claim_path ?? null,
    input.client_nonce ?? null
  ]);
}

// Postgres constrains this column, so a value outside the four cannot reach the
// aggregate there. Rejecting it here keeps the adapters answering alike instead
// of producing a row whose total exceeds the columns that make it up.
const VERDICTS = Object.freeze(['true', 'false', 'unclear', 'needs_work']);

const EMPTY_ROW = Object.freeze({
  true_count: 0,
  false_count: 0,
  unclear_count: 0,
  needs_work_count: 0,
  total: 0
});

/**
 * VerdictStore backed by process memory, for rooms configured without a
 * database. A peer of the Postgres adapter, not a degraded mode: the shared
 * contract suite runs against both, which is what stops the aggregate here
 * drifting from verify_summary the way it previously did.
 *
 * Storage is the maps the rest of the process already keeps — verdicts of its
 * own, and the submission index it reads claims out of.
 */
export class MemoryVerdictStore {
  /**
   * @param {object} opts
   * @param {Map} opts.verdicts        verdict storage; must not evict
   * @param {Map} opts.submissionIndex submissions, for reading claim terms back
   * @param {number} [opts.capacity]   most distinct verdicts held before writes
   *   are refused. Eviction is not an option — dropping an older verdict makes
   *   the summary report fewer findings than were filed, silently — but neither
   *   is growing without limit, because client_nonce mints a new identity and a
   *   client sending valid revisions would exhaust the heap. So it fills up and
   *   says so, the same choice made for a database that cannot be reached.
   */
  constructor({ verdicts, submissionIndex, capacity = 50_000 }) {
    this.verdicts = verdicts;
    this.submissionIndex = submissionIndex;
    this.capacity = capacity;
  }

  async submitVerdict(input) {
    if (this.submissionIndex && !this.submissionIndex.has(input.submission_id)) {
      throw new Error('submission_not_found');
    }
    if (!VERDICTS.includes(input.verdict)) throw new Error('invalid_verdict');

    const key = verdictKey(input);
    const existing = this.verdicts.get(key);
    // Idempotent on the same tuple, matching verify_submit's ON CONFLICT. A
    // repeat is not a new identity, so it is answered even when full: refusing
    // it would break idempotency for a client retrying after a timeout.
    if (existing) return { id: existing.id, note: 'db_fallback' };

    if (this.verdicts.size >= this.capacity) throw new Error('verdict_capacity_reached');

    const id = crypto.randomUUID();
    this.verdicts.set(key, { id, verdict: input.verdict, rationale: input.rationale });
    return { id, note: 'db_fallback' };
  }

  async summary(roundId) {
    const rows = new Map();

    for (const [key, value] of this.verdicts.entries()) {
      const [round, , submissionId, claimId, claimPath] = JSON.parse(key);
      if (round !== roundId) continue;

      // Grouped by path, matching verify_summary. Without the path this merges
      // the two findings it exists to separate, and the same room reports
      // differently depending on which adapter is in use.
      const groupKey = JSON.stringify([submissionId, claimId, claimPath]);
      if (!rows.has(groupKey)) {
        rows.set(groupKey, {
          submission_id: submissionId,
          claim_id: claimId,
          claim_path: claimPath,
          ...EMPTY_ROW
        });
      }

      const row = rows.get(groupKey);
      row.total += 1;
      row[`${value.verdict}_count`] += 1;
    }

    return [...rows.values()].sort(
      (a, b) =>
        String(a.submission_id).localeCompare(String(b.submission_id)) ||
        (a.claim_id || '').localeCompare(b.claim_id || '') ||
        (a.claim_path || '').localeCompare(b.claim_path || '')
    );
  }

  async claimTerm(submissionId, claimId) {
    const claims = this.submissionIndex?.get(submissionId)?.claims;
    return claims?.find((c) => c?.id === claimId)?.term ?? undefined;
  }
}
