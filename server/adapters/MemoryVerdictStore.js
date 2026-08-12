import crypto from 'node:crypto';

// A JSON tuple, not a delimiter-joined string. claim_id is author-supplied and
// may contain the delimiter: "source:claim" shifted every field after it when
// the key was split back apart, corrupting the summary rows.
function verdictKey(input) {
  return JSON.stringify([
    input.round_id,
    input.reporter_id,
    input.submission_id,
    input.claim_id ?? null,
    input.claim_path ?? null
  ]);
}

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
  constructor({ verdicts, submissionIndex }) {
    this.verdicts = verdicts;
    this.submissionIndex = submissionIndex;
  }

  async submitVerdict(input) {
    if (this.submissionIndex && !this.submissionIndex.has(input.submission_id)) {
      throw new Error('submission_not_found');
    }

    const key = verdictKey(input);
    const existing = this.verdicts.get(key);
    // Idempotent on the same tuple, matching verify_submit's ON CONFLICT.
    if (existing) return { id: existing.id, note: 'db_fallback' };

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
      const field = `${value.verdict}_count`;
      if (field in row) row[field] += 1;
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
