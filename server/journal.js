import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonicalizeJCS, canonicalizeSorted, sha256Hex } from './utils.js';

/**
 * createSigner creates an Ed25519 signer and public key export.
 * Note: generateKeyPairSync is synchronous and may block briefly; avoid in serverless.
 */
export function createSigner({ privateKeyPem, publicKeyPem, canonMode = 'sorted' } = {}) {
  let privateKey;
  let publicKey;
  let dev = false;
  if (privateKeyPem && publicKeyPem) {
    try {
      privateKey = crypto.createPrivateKey(privateKeyPem);
      publicKey = crypto.createPublicKey(publicKeyPem);
    } catch (err) {
      const msg =
        'Invalid SIGNING_PRIVATE_KEY or SIGNING_PUBLIC_KEY PEM format. Provide valid PEM-encoded Ed25519 keys.';
      throw new Error(msg, { cause: err });
    }
  } else {
    // Dev-only in-memory keypair
    console.warn(
      '[journal] Using in-memory dev keypair — provide SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY (PEM) in production.'
    );
    const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync('ed25519');
    privateKey = priv;
    publicKey = pub;
    dev = true;
  }
  const publicKeyRaw = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyB64 = Buffer.from(publicKeyRaw).toString('base64');

  function signHash(hashHex) {
    const sig = crypto.sign(null, Buffer.from(hashHex, 'hex'), privateKey);
    return Buffer.from(sig).toString('base64');
  }

  const canonicalizer =
    String(canonMode).toLowerCase() === 'jcs' ? canonicalizeJCS : canonicalizeSorted;

  return { signHash, publicKeyB64, canonicalizer, dev };
}

// Compute a compact, deterministic journal core for hashing and signing
export function buildJournalCore({
  room_id,
  round_id,
  idx,
  phase,
  submit_deadline_unix,
  published_at_unix,
  continue_vote_close_unix,
  continue_tally,
  transcript_hashes,
  prev_hash
}) {
  function toSafeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return {
    v: 1,
    room_id,
    round_id,
    idx: toSafeNumber(idx),
    phase,
    submit_deadline_unix: toSafeNumber(submit_deadline_unix || 0),
    published_at_unix: toSafeNumber(published_at_unix || 0),
    continue_vote_close_unix: toSafeNumber(continue_vote_close_unix || 0),
    continue_tally: {
      yes: toSafeNumber(continue_tally?.yes || 0),
      no: toSafeNumber(continue_tally?.no || 0)
    },
    transcript_hashes: Array.isArray(transcript_hashes) ? transcript_hashes : [],
    prev_hash: prev_hash || null
  };
}

export function finalizeJournal({ core, signer }) {
  const canon = signer.canonicalizer(core);
  const hash = sha256Hex(canon);
  const sigB64 = signer.signHash(hash);
  return {
    version: 1,
    core,
    hash,
    signature: {
      alg: 'ed25519',
      input: 'hash',
      public_key_b64: signer.publicKeyB64,
      sig_b64: sigB64,
      canonical: signer.canonicalizer === canonicalizeJCS ? 'jcs' : 'sorted'
    },
    dev_key: signer.dev || false,
    issued_at_unix: Math.floor(Date.now() / 1000)
  };
}
