import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

export class AuthService {
  constructor({ dbRef, memAuthChallenges, memParticipantFingerprints, config }) {
    this.dbRef = dbRef;
    this.memAuthChallenges = memAuthChallenges;
    this.memParticipantFingerprints = memParticipantFingerprints;
    this.config = config;
  }

  get pool() {
    return this.dbRef.pool;
  }

  createChallenge(roomId, participantId) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    this.memAuthChallenges.set(nonce, {
      room_id: roomId,
      participant_id: participantId,
      expires_at: expiresAt
    });
    return { nonce, expires_at: expiresAt, audience: 'db8' };
  }

  async verify({
    room_id,
    participant_id,
    nonce,
    signature_kind,
    sig_b64,
    public_key_b64,
    public_key_ssh
  }) {
    const challenge = this.memAuthChallenges.get(nonce);
    if (!challenge || challenge.expires_at <= Math.floor(Date.now() / 1000))
      throw new Error('invalid_or_expired_nonce');
    if (challenge.room_id !== room_id || challenge.participant_id !== participant_id)
      throw new Error('challenge_mismatch');

    let pubDer;
    if (signature_kind === 'ed25519') {
      if (!public_key_b64) throw new Error('missing_public_key_b64');
      pubDer = Buffer.from(public_key_b64, 'base64');
    } else {
      if (!public_key_ssh) throw new Error('missing_public_key_ssh');
      pubDer = this.parseOpenSshEd25519ToSpkiDer(public_key_ssh);
    }

    const pubKey = crypto.createPublicKey({ format: 'der', type: 'spki', key: pubDer });
    const ok = crypto.verify(null, Buffer.from(nonce), pubKey, Buffer.from(sig_b64, 'base64'));
    if (!ok) throw new Error('invalid_signature');

    const fpHex = crypto.createHash('sha256').update(pubDer).digest('hex');
    const fingerprint = `sha256:${fpHex}`;

    if (this.pool) {
      const r = await this.pool.query(
        'SELECT ssh_fingerprint FROM participants_view WHERE id = $1 AND room_id = $2 LIMIT 1',
        [participant_id, room_id]
      );
      if (!r.rows[0]) throw new Error('participant_not_found_in_room');
      const storedFp = String(r.rows[0].ssh_fingerprint || '').trim();
      if (storedFp) {
        const expected = storedFp.toLowerCase().startsWith('sha256:')
          ? storedFp.toLowerCase()
          : `sha256:${storedFp.toLowerCase()}`;
        if (expected !== fingerprint) throw new Error('author_binding_mismatch');
      } else if (this.config.enforceAuthorBinding) {
        throw new Error('author_not_configured');
      }
    } else {
      // Memory path
      const storedFp = this.memParticipantFingerprints.get(participant_id);
      if (storedFp) {
        if (storedFp !== fingerprint) throw new Error('author_binding_mismatch');
      } else if (this.config.enforceAuthorBinding) {
        throw new Error('author_not_configured');
      }
    }

    this.memAuthChallenges.delete(nonce);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ room_id, participant_id, exp: expiresAt })
    ).toString('base64url');
    return {
      ok: true,
      jwt: `${header}.${payload}.sig`,
      room_id,
      participant_id,
      expires_at: expiresAt
    };
  }

  async setFingerprint(participantId, { publicKeyB64, fingerprint }) {
    let normalized = fingerprint;
    if (publicKeyB64) {
      const der = Buffer.from(String(publicKeyB64), 'base64');
      const hex = crypto.createHash('sha256').update(der).digest('hex');
      normalized = `sha256:${hex}`;
    }
    if (normalized) {
      normalized = normalized.toLowerCase();
      if (!normalized.startsWith('sha256:')) {
        normalized = `sha256:${normalized}`;
      }
    }

    if (this.pool) {
      try {
        const r = await this.pool.query(
          'SELECT participant_fingerprint_set($1::uuid,$2::text) AS fingerprint',
          [participantId, publicKeyB64 ? String(publicKeyB64) : String(normalized)]
        );
        return String(r.rows[0].fingerprint);
      } catch (err) {
        console.error('[AuthService] DB error, falling back to memory:', err.message);
      }
    }
    this.memParticipantFingerprints.set(participantId, normalized);
    return normalized;
  }

  async verifySSHSignature({ canonicalJson, sigB64, principal, allowedSignersPath }) {
    const msgPath = path.join(os.tmpdir(), `db8-msg-${crypto.randomUUID()}`);
    const sigPath = path.join(os.tmpdir(), `db8-sig-${crypto.randomUUID()}`);
    try {
      await fs.writeFile(msgPath, canonicalJson);
      await fs.writeFile(
        sigPath,
        Buffer.concat([Buffer.from('SSHSIG'), Buffer.from(sigB64, 'base64')])
      );
      await execFileP(
        'ssh-keygen',
        ['-Y', 'verify', '-f', allowedSignersPath, '-I', principal, '-n', 'db8', '-s', sigPath],
        { input: canonicalJson }
      );
      return true;
    } finally {
      await Promise.all([fs.unlink(msgPath).catch(() => {}), fs.unlink(sigPath).catch(() => {})]);
    }
  }

  parseOpenSshEd25519ToSpkiDer(sshKeyString) {
    const parts = sshKeyString.trim().split(/\s+/);
    if (parts.length < 2 || parts[0] !== 'ssh-ed25519') throw new Error('not_ed25519');
    const keyBuf = Buffer.from(parts[1], 'base64');
    let off = 0;
    const readBuf = () => {
      const len = keyBuf.readUInt32BE(off);
      off += 4;
      const res = keyBuf.slice(off, off + len);
      off += len;
      return res;
    };
    if (readBuf().toString() !== 'ssh-ed25519') throw new Error('not_ed25519');
    const pub = readBuf();
    return Buffer.concat([
      Buffer.from([0x30, 0x2a, 0x30, 0x05]),
      Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70]),
      Buffer.from([0x03, 0x21, 0x00]),
      pub
    ]);
  }
}
