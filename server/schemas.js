import { z } from 'zod';

export const Claim = z.object({
  id: z.string(),
  text: z.string().min(3),
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
  room_id: z.string().uuid(),
  round_id: z.string().uuid(),
  author_id: z.string().uuid(),
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
  room_id: z.string().uuid(),
  round_id: z.string().uuid(),
  voter_id: z.string().uuid(),
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
  submission_id: z.string().uuid(),
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
      room_id: z.string().uuid(),
      round_id: z.string().uuid(),
      author_id: z.string().uuid(),
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
    participant_id: z.string().uuid(),
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
