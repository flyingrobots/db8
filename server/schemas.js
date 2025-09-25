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
  phase: z.enum(['OPENING', 'ARGUMENT', 'FINAL']),
  deadline_unix: z.number().int(),
  content: z.string().min(1).max(4000),
  claims: z.array(Claim).min(1).max(5),
  citations: z.array(Citation).min(2),
  client_nonce: z.string().min(8),
  signature_kind: z.enum(['ssh', 'ed25519']).optional(),
  signature_b64: z.string().optional(),
  signer_fingerprint: z.string().optional()
});
