import express from 'express';
import { SubmissionIn, SubmissionFlag } from '../schemas.js';
import { validateTerm } from '../claims/terms.js';

// The schema already rejects an invalid term, so this gate is deliberate
// redundancy at the trust boundary: it names the offending claim and returns the
// term's own error paths, where a schema failure arrives as a serialized Zod
// issue list. It is also the layer that survives someone swapping the schema.
function termErrors(claims) {
  const out = [];
  for (const [index, claim] of (claims ?? []).entries()) {
    const result = validateTerm(claim?.term);
    if (result.ok) continue;
    for (const error of result.errors) {
      out.push({ claim_id: claim?.id ?? null, claim_index: index, ...error });
    }
  }
  return out;
}

export function createSubmissionRouter({ submissionService, requireDbInProduction, memFlags }) {
  const router = express.Router();

  // submission.create
  router.post('/rpc/submission.create', requireDbInProduction, async (req, res) => {
    try {
      const input = SubmissionIn.parse(req.body);

      const invalid = termErrors(input.claims);
      if (invalid.length > 0) {
        return res.status(400).json({ ok: false, error: 'invalid_claim_term', details: invalid });
      }

      const result = await submissionService.create(input, { forceDlq: req.body._force_dlq });
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err.message === 'forced_failure_queued')
        return res.status(500).json({ ok: false, error: err.message });
      if (err.message === 'deadline_passed' || err.message === 'invalid_nonce')
        return res.status(400).json({ ok: false, error: err.message });
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // submission.flag
  router.post('/rpc/submission.flag', requireDbInProduction, async (req, res) => {
    try {
      const input = SubmissionFlag.parse(req.body);
      const db = submissionService.db;
      if (db) {
        const r = await db.query(
          'SELECT submission_flag($1::uuid,$2::uuid,$3::text,$4::text) AS count',
          [input.submission_id, input.reporter_id, input.reporter_role, input.reason]
        );
        return res.json({ ok: true, flag_count: Number(r.rows[0].count) });
      }
      // Memory fallback
      if (!submissionService.memSubmissionIndex.has(input.submission_id)) {
        return res.status(404).json({ ok: false, error: 'submission_not_found' });
      }
      const flags = memFlags.get(input.submission_id) || new Map();
      if (flags.has(input.reporter_id)) {
        return res.json({ ok: true, flag_count: flags.size, note: 'duplicate_flag' });
      }
      flags.set(input.reporter_id, {
        role: input.reporter_role,
        reason: input.reason,
        created_at: new Date().toISOString()
      });
      memFlags.set(input.submission_id, flags);
      return res.json({ ok: true, flag_count: flags.size, note: 'db_fallback' });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
