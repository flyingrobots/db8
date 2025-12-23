import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

describe('SSH Auth (Challenge/Verify)', () => {
  const roomId = '10000000-0000-0000-0000-000000000001';
  const participantId = '10000000-0000-0000-0000-000000000003';

  beforeAll(() => {
    __setDbPool(null);
  });

  it('GET /auth/challenge returns a nonce', async () => {
    const res = await supertest(app)
      .get('/auth/challenge')
      .query({ room_id: roomId, participant_id: participantId });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.nonce).toBeDefined();
    expect(res.body.nonce.length).toBeGreaterThan(16);
    expect(res.body.audience).toBe('db8');
  });

  it('POST /auth/verify verifies an ed25519 signature', async () => {
    // 1. Get challenge
    const cRes = await supertest(app)
      .get('/auth/challenge')
      .query({ room_id: roomId, participant_id: participantId });
    const nonce = cRes.body.nonce;

    // 2. Sign nonce
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const sig = crypto.sign(null, Buffer.from(nonce), privateKey);
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });

    // 3. Verify
    const vRes = await supertest(app)
      .post('/auth/verify')
      .send({
        room_id: roomId,
        participant_id: participantId,
        nonce,
        signature_kind: 'ed25519',
        sig_b64: sig.toString('base64'),
        public_key_b64: pubDer.toString('base64')
      });

    if (vRes.status !== 200) console.error(vRes.body);
    expect(vRes.status).toBe(200);
    expect(vRes.body.ok).toBe(true);
    expect(vRes.body.jwt).toBeDefined();
    expect(vRes.body.jwt.split('.').length).toBe(3);
  });

  it('POST /auth/verify verifies an OpenSSH (ssh-ed25519) signature', async () => {
    // 1. Get challenge
    const cRes = await supertest(app)
      .get('/auth/challenge')
      .query({ room_id: roomId, participant_id: participantId });
    const nonce = cRes.body.nonce;

    // 2. Sign nonce (using standard ed25519 for signature, but passing ssh-ed25519 format)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const sig = crypto.sign(null, Buffer.from(nonce), privateKey);

    // Simulate OpenSSH public key string
    const rawPub = publicKey.export({ format: 'der', type: 'spki' }).slice(12);
    const typeBuf = Buffer.from('ssh-ed25519');
    const b = Buffer.alloc(4 + typeBuf.length + 4 + rawPub.length);
    let off = 0;
    b.writeUInt32BE(typeBuf.length, off);
    off += 4;
    typeBuf.copy(b, off);
    off += typeBuf.length;
    b.writeUInt32BE(rawPub.length, off);
    off += 4;
    rawPub.copy(b, off);

    const sshPubKey = `ssh-ed25519 ${b.toString('base64')} user@host`;

    // 3. Verify
    const vRes = await supertest(app)
      .post('/auth/verify')
      .send({
        room_id: roomId,
        participant_id: participantId,
        nonce,
        signature_kind: 'ssh',
        sig_b64: sig.toString('base64'),
        public_key_ssh: sshPubKey
      });

    if (vRes.status !== 200) console.error(vRes.body);
    expect(vRes.status).toBe(200);
    expect(vRes.body.ok).toBe(true);
  });

  it('POST /auth/verify rejects mismatching room/participant', async () => {
    const cRes = await supertest(app)
      .get('/auth/challenge')
      .query({ room_id: roomId, participant_id: participantId });
    const nonce = cRes.body.nonce;

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const sig = crypto.sign(null, Buffer.from(nonce), privateKey);
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });

    const vRes = await supertest(app)
      .post('/auth/verify')
      .send({
        room_id: '20000000-0000-0000-0000-000000000001',
        participant_id: participantId,
        nonce,
        signature_kind: 'ed25519',
        sig_b64: sig.toString('base64'),
        public_key_b64: pubDer.toString('base64')
      });

    expect(vRes.status).toBe(400);
    expect(vRes.body.error).toBe('challenge_mismatch');
  });
});
