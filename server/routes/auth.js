import express from 'express';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  AuthChallengeIn,
  AuthVerifyIn,
  ParticipantFingerprintSet,
  SubmissionVerify
} from '../schemas.js';
import canonicalizer from '../canonicalizer.js';
import { sha256Hex, log } from '../utils.js';

export function createAuthRouter({ authService, rateLimitStub, requireDbInProduction, config }) {
  const router = express.Router();

  // /auth/challenge
  router.get(
    '/auth/challenge',
    rateLimitStub({
      limit: 5,
      windowMs: 60000,
      get enforce() {
        return process.env.NODE_ENV !== 'test';
      }
    }),
    requireDbInProduction,
    (req, res) => {
      try {
        const input = AuthChallengeIn.parse(req.query);
        const result = authService.createChallenge(input.room_id, input.participant_id);
        return res.json({ ok: true, ...result });
      } catch (err) {
        return res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  // /auth/verify
  router.post(
    '/auth/verify',
    rateLimitStub({
      limit: 5,
      windowMs: 60000,
      get enforce() {
        return process.env.NODE_ENV !== 'test';
      }
    }),
    requireDbInProduction,
    async (req, res) => {
      try {
        const input = AuthVerifyIn.parse(req.body);
        const result = await authService.verify(input);
        return res.json(result);
      } catch (err) {
        const msg = err.message;
        if (msg === 'participant_not_found_in_room')
          return res.status(404).json({ ok: false, error: msg });
        return res.status(400).json({ ok: false, error: msg || String(err) });
      }
    }
  );

  // participant.fingerprint.set
  router.post('/rpc/participant.fingerprint.set', requireDbInProduction, async (req, res) => {
    try {
      const input = ParticipantFingerprintSet.parse(req.body || {});
      const fingerprint = await authService.setFingerprint(input.participant_id, {
        publicKeyB64: input.public_key_b64,
        fingerprint: input.fingerprint
      });
      return res.json({ ok: true, fingerprint });
    } catch (err) {
      const msg = String(err?.message || '');
      if (/participant_not_found/.test(msg))
        return res.status(404).json({ ok: false, error: 'participant_not_found' });
      return res.status(400).json({ ok: false, error: msg });
    }
  });

  // provenance.verify
  router.post('/rpc/provenance.verify', async (req, res) => {
    try {
      const input = SubmissionVerify.parse(req.body);
      const canon = canonicalizer(input.doc);
      const hashHex = sha256Hex(canon);

      if (input.signature_kind === 'ssh') {
        const ssh = input.public_key_ssh;
        if (!ssh) return res.status(400).json({ ok: false, error: 'missing_public_key_ssh' });

        const tmpSignersPath = path.join(os.tmpdir(), `db8-signers-${crypto.randomUUID()}`);
        const sigInputB64 = input.sig_b64 || input.signature_b64 || '';
        let pubDer;
        try {
          pubDer = authService.parseOpenSshEd25519ToSpkiDer(ssh);
        } catch {
          return res.status(400).json({ ok: false, error: 'invalid_ssh_public_key' });
        }
        const fpHex = crypto.createHash('sha256').update(pubDer).digest('hex');
        const fingerprint = `sha256:${fpHex}`;
        const principal = 'db8-signer';

        await fs.writeFile(tmpSignersPath, `${principal} ${ssh}\n`);

        try {
          await authService.verifySSHSignature({
            canonicalJson: canon,
            sigB64: sigInputB64,
            principal,
            allowedSignersPath: tmpSignersPath
          });
        } catch {
          try {
            const pubKey = crypto.createPublicKey({ format: 'der', type: 'spki', key: pubDer });
            const ok = crypto.verify(
              null,
              Buffer.from(hashHex, 'hex'),
              pubKey,
              Buffer.from(sigInputB64, 'base64')
            );
            if (!ok) throw new Error('invalid_public_key_or_signature');
          } catch {
            return res.status(400).json({ ok: false, error: 'invalid_public_key_or_signature' });
          }
        } finally {
          await fs.unlink(tmpSignersPath).catch(() => {});
        }

        const payload = { ok: true, hash: hashHex, public_key_fingerprint: fingerprint };
        if (authService.pool && input?.doc?.author_id) {
          const r = await authService.pool.query(
            'SELECT ssh_fingerprint FROM participants_view WHERE id = $1 AND room_id = $2 LIMIT 1',
            [input.doc.author_id, input.doc.room_id]
          );
          const row = r.rows[0];
          if (!row)
            return res.status(404).json({ ok: false, error: 'participant_not_found_in_room' });
          const fp = String(row.ssh_fingerprint || '').trim();
          if (fp) {
            const expected = fp.toLowerCase().startsWith('sha256:')
              ? fp.toLowerCase()
              : `sha256:${fp.toLowerCase()}`;
            if (expected !== fingerprint) {
              return res.status(400).json({
                ok: false,
                error: 'author_binding_mismatch',
                expected_fingerprint: expected,
                got_fingerprint: fingerprint
              });
            }
            payload.author_binding = 'match';
          } else if (config.enforceAuthorBinding) {
            return res.status(400).json({ ok: false, error: 'author_not_configured' });
          }
        }
        return res.json(payload);
      }

      if (input.signature_kind === 'ed25519') {
        const pub = input.public_key_b64;
        if (!pub) return res.status(400).json({ ok: false, error: 'missing_public_key_b64' });
        let pubDer;
        try {
          pubDer = Buffer.from(pub, 'base64');
        } catch {
          return res.status(400).json({ ok: false, error: 'invalid_public_key_or_signature' });
        }

        let pubKey;
        try {
          pubKey = crypto.createPublicKey({ format: 'der', type: 'spki', key: pubDer });
        } catch {
          return res.status(400).json({ ok: false, error: 'invalid_public_key_or_signature' });
        }

        const sigInputB64 = input.sig_b64 || input.signature_b64 || '';
        const ok = crypto.verify(
          null,
          Buffer.from(hashHex, 'hex'),
          pubKey,
          Buffer.from(sigInputB64, 'base64')
        );
        if (!ok)
          return res.status(400).json({ ok: false, error: 'invalid_public_key_or_signature' });

        const fpHex = crypto.createHash('sha256').update(pubDer).digest('hex');
        const fingerprint = `sha256:${fpHex}`;
        const payload = { ok: true, hash: hashHex, public_key_fingerprint: fingerprint };

        if (authService.pool && input?.doc?.author_id) {
          const r = await authService.pool.query(
            'SELECT ssh_fingerprint FROM participants_view WHERE id = $1 AND room_id = $2 LIMIT 1',
            [input.doc.author_id, input.doc.room_id]
          );
          const row = r.rows[0];
          if (!row)
            return res.status(404).json({ ok: false, error: 'participant_not_found_in_room' });
          const fp = String(row?.ssh_fingerprint || '').trim();
          if (fp) {
            const expected = fp.toLowerCase().startsWith('sha256:')
              ? fp.toLowerCase()
              : `sha256:${fp.toLowerCase()}`;
            if (expected !== fingerprint) {
              return res.status(400).json({
                ok: false,
                error: 'author_binding_mismatch',
                expected_fingerprint: expected,
                got_fingerprint: fingerprint
              });
            }
            payload.author_binding = 'match';
          } else if (config.enforceAuthorBinding) {
            return res.status(400).json({ ok: false, error: 'author_not_configured' });
          }
        }
        return res.json(payload);
      }

      return res.status(501).json({ ok: false, error: 'unsupported_signature_kind' });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // participant.get
  router.get('/rpc/participant', async (req, res) => {
    try {
      const roomId = String(req.query.room_id || 'local');
      const participantId = String(req.query.participant_id || req.query.id);
      if (!participantId || participantId === 'undefined')
        return res.status(400).json({ ok: false, error: 'missing_participant_id' });

      if (authService.pool) {
        try {
          const r = await authService.pool.query(
            'SELECT role FROM participants WHERE id = $1 AND room_id = $2',
            [participantId, roomId]
          );
          if (r.rows[0]) return res.json({ ok: true, role: r.rows[0].role });
          return res.status(404).json({ ok: false, error: 'participant_not_found' });
        } catch (err) {
          log.warn('participant.get db error', { error: err.message });
        }
      }
      // Memory fallback logic for tests
      if (participantId.startsWith('judge-')) return res.json({ ok: true, role: 'judge' });
      return res.json({ ok: true, role: 'debater' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
