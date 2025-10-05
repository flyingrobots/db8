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

export const SubmissionVerify = z.object({
  doc: z.object({
    room_id: z.string().uuid(),
    round_id: z.string().uuid(),
    author_id: z.string().uuid(),
    phase: z.enum(['submit', 'published', 'final']),
    deadline_unix: z.number().int(),
    content: z.string().min(1),
    claims: z.array(Claim).min(1),
    citations: z.array(Citation).min(2),
    client_nonce: z.string().min(8)
  }),
  signature_kind: z.enum(['ed25519', 'ssh']),
  sig_b64: z.string().min(1),
  public_key_b64: z.string().optional()
});
