import { z } from 'zod';
import { validateTerm } from './claims/terms.js';
import { parsePath, formatPath } from './claims/paths.js';

// Delegates to validateTerm rather than composing the raw ClaimTerm schema.
//
// Two reasons. The schema alone enforces shape but none of the rules
// validateTerm adds — the depth and size caps, the __proto__ refusal, either
// distinctness, temporal anchoring — so wiring it directly left every one of
// those enforced nowhere a submission passes through. And validateTerm measures
// depth and size *before* Zod recurses, which a `.superRefine()` on ClaimTerm
// could not do: Zod would parse first and exhaust the stack on a deep term
// before any refinement ran.
const ClaimTermField = z.unknown().transform((value, ctx) => {
  const result = validateTerm(value);
  if (result.ok) return result.value;
  for (const error of result.errors) {
    ctx.addIssue({ code: 'custom', message: `${error.path}: ${error.message}` });
  }
  return z.NEVER;
});

export const Claim = z.object({
  id: z.string().min(1),
  // The assertion is a structured term, not prose. `support` is unchanged:
  // evidence is orthogonal to term structure, and replacing it is a stated
  // non-goal in docs/specs/ClaimTerms.md.
  term: ClaimTermField,
  support: z
    .array(
      z.object({
        kind: z.enum(['citation', 'logic', 'data']),
        ref: z.string()
      })
    )
    .min(1)
});

export const Citation = z.object({ url: z.string().url(), title: z.string().optional() });

export const SubmissionIn = z.object({
  room_id: z.guid(),
  round_id: z.guid(),
  author_id: z.guid(),
  // Align phases with DB: submit|published|final
  phase: z.enum(['submit', 'published', 'final']),
  deadline_unix: z.number().int(),
  content: z.string().min(1).max(4000),
  claims: z.array(Claim).min(1).max(5),
  citations: z.array(Citation).min(2),
  client_nonce: z.string().min(8),
  signature_kind: z.enum(['ssh', 'ed25519']).optional(),
  signature_b64: z.string().optional(),
  signer_fingerprint: z.string().optional()
});

export const ContinueVote = z.object({
  room_id: z.guid(),
  round_id: z.guid(),
  voter_id: z.guid(),
  choice: z.enum(['continue', 'end']),
  client_nonce: z.string().min(8)
});

export const RoomCreate = z.object({
  topic: z.string().min(3),
  cfg: z
    .object({
      participant_count: z.number().int().min(1).max(64).optional(),
      submit_minutes: z.number().int().min(1).max(1440).optional()
    })
    .optional(),
  client_nonce: z.string().min(8).optional()
});

export const SubmissionFlag = z.object({
  submission_id: z.guid(),
  reporter_id: z.string().min(1),
  reporter_role: z
    .enum(['participant', 'moderator', 'fact_checker', 'viewer', 'system'])
    .optional()
    .default('participant'),
  reason: z.string().max(500).optional().default('')
});

export const SubmissionVerify = z
  .object({
    doc: z.object({
      room_id: z.guid(),
      round_id: z.guid(),
      author_id: z.guid(),
      phase: z.enum(['submit', 'published', 'final']),
      deadline_unix: z.number().int(),
      content: z.string().min(1).max(4000),
      claims: z.array(Claim).min(1).max(5),
      citations: z.array(Citation).min(2),
      client_nonce: z.string().min(8)
    }),
    signature_kind: z.enum(['ed25519', 'ssh']),
    // Accept both legacy sig_b64 and the more explicit signature_b64 for forward compatibility
    sig_b64: z.string().min(1).optional(),
    signature_b64: z.string().min(1).optional(),
    // Accept legacy public_key_b64; signer_fingerprint may be used by future flows
    public_key_b64: z.string().optional(),
    // SSH (OpenSSH) public key string (e.g., "ssh-ed25519 AAAA... comment")
    public_key_ssh: z.string().optional(),
    signer_fingerprint: z.string().optional()
  })
  .refine((v) => Boolean(v.sig_b64 || v.signature_b64), {
    message: 'missing_signature',
    path: ['sig_b64']
  });

// Participant fingerprint enrollment
export const ParticipantFingerprintSet = z
  .object({
    participant_id: z.guid(),
    public_key_b64: z.string().optional(),
    fingerprint: z.string().optional()
  })
  .refine(
    (v) => {
      const a = Boolean(v.public_key_b64);
      const b = Boolean(v.fingerprint);
      return (a || b) && !(a && b);
    },
    {
      message: 'provide_exactly_one_of_public_key_b64_or_fingerprint',
      path: ['public_key_b64']
    }
  )
  .refine(
    (v) => {
      if (v.fingerprint === undefined) return true;
      const s = String(v.fingerprint).toLowerCase();
      return /^(sha256:)?[0-9a-f]{64}$/.test(s);
    },
    {
      message: 'invalid_fingerprint_format',
      path: ['fingerprint']
    }
  );

// M3: Verification submit payload
export const VerifySubmit = z
  .object({
    round_id: z.guid(),
    reporter_id: z.guid(),
    submission_id: z.guid(),
    claim_id: z.string().optional(),
    // Which node of the claim term this verdict rules on. Absent means the claim
    // as a whole. Without it, "the source does not say that" and "the source says
    // it and is wrong" are the same row.
    // Normalized on the way in. parsePath accepts non-canonical aliases, and the
    // uniqueness key and verify_summary group on the stored string — so
    // `$.parts[01]` and `$.parts[1]` would split one node into two findings.
    claim_path: z
      .string()
      .refine((v) => parsePath(v) !== null, { message: 'claim_path must be a valid term path' })
      .transform((v) => formatPath(parsePath(v)))
      .optional(),
    verdict: z.enum(['true', 'false', 'unclear', 'needs_work']),
    rationale: z.string().max(2000).optional(),
    client_nonce: z.string().min(8)
  })
  // A path names a node *within a claim's term*, so without a claim_id it
  // addresses nothing — yet it was persisted, keyed into the uniqueness index
  // and grouped into verify_summary as a distinct finding.
  .refine((v) => v.claim_path === undefined || v.claim_id !== undefined, {
    message: 'claim_path requires claim_id',
    path: ['claim_path']
  });

export const FinalVote = z.object({
  round_id: z.guid(),
  voter_id: z.guid(),
  approval: z.boolean(),
  ranking: z.array(z.guid()).optional(),
  client_nonce: z.string().min(8).optional()
});

export const ScoreSubmit = z.object({
  round_id: z.guid(),
  judge_id: z.guid(),
  participant_id: z.guid(),
  e: z.number().int().min(0).max(100),
  r: z.number().int().min(0).max(100),
  c: z.number().int().min(0).max(100),
  v: z.number().int().min(0).max(100),
  y: z.number().int().min(0).max(100),
  client_nonce: z.string().min(8).optional()
});

export const ScoreGet = z.object({
  round_id: z.guid()
});

export const ReputationGet = z.object({
  participant_id: z.guid(),
  tag: z.string().optional()
});

export const ResearchFetch = z.object({
  room_id: z.guid(),
  round_id: z.guid(),
  participant_id: z.guid(),
  url: z.string().url()
});

export const ResearchCacheGet = z.object({
  url: z.string().url()
});

// SSH Auth schemas
export const AuthChallengeIn = z.object({
  room_id: z.guid(),
  participant_id: z.guid()
});

export const AuthVerifyIn = z.object({
  room_id: z.guid(),
  participant_id: z.guid(),
  nonce: z.string().min(8),
  signature_kind: z.enum(['ed25519', 'ssh']),
  sig_b64: z.string().min(1),
  public_key_ssh: z.string().optional(),
  public_key_b64: z.string().optional()
});
