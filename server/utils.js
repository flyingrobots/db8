import crypto from 'node:crypto';
import fs from 'node:fs';
import canonicalizeJcsLib from 'canonicalize';

// Deterministic sorted-key canonicalization (legacy M1 default)
export function canonicalizeSorted(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) throw new Error('Cannot canonicalize circular structure');
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    // Null prototype, because `out.__proto__ = x` on an ordinary object is a
    // prototype assignment, not an own property: the key vanishes and a payload
    // containing `__proto__` canonicalizes identically to one without it.
    const out = Object.create(null);
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

// RFC 8785 JCS canonicalization
export function canonicalizeJCS(value) {
  return canonicalizeJcsLib(value);
}

// Back-compat export used in tests and callers
export const canonicalize = canonicalizeSorted;

// Structured Logger (M7)
export const log = {
  info: (msg, details = {}) =>
    console.warn(JSON.stringify({ level: 'info', t: Date.now(), msg, ...details })),
  warn: (msg, details = {}) =>
    console.warn(JSON.stringify({ level: 'warn', t: Date.now(), msg, ...details })),
  error: (msg, details = {}) =>
    console.error(JSON.stringify({ level: 'error', t: Date.now(), msg, ...details }))
};

// Ed25519 public keys are derivable from the private key, so the private key is
// the single source of truth and the .pub file is only a published convenience.
// Correctness never depends on reading it, which is what makes concurrent
// startup safe.
function derivePublicPem(privateKeyPem) {
  return crypto
    .createPublicKey(crypto.createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

function spki(pem) {
  return crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');
}

// M7: Ensure signing keys exist
export function getPersistentSigningKeys() {
  const privPath = process.env.SIGNING_PRIVATE_KEY_PATH || './.db8_signing_key';
  const pubPath = process.env.SIGNING_PUBLIC_KEY_PATH || './.db8_signing_key.pub';

  if (process.env.SIGNING_PRIVATE_KEY && process.env.SIGNING_PUBLIC_KEY) {
    return {
      privateKeyPem: process.env.SIGNING_PRIVATE_KEY,
      publicKeyPem: process.env.SIGNING_PUBLIC_KEY
    };
  }

  // Publish the public half atomically. Every process derives identical bytes
  // from the same private key, so clobbering via rename is safe — and rename
  // means a concurrent reader sees the old file or the new one, never a
  // half-written one.
  const publishPublic = (pem) => {
    const tmp = `${pubPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
    try {
      fs.writeFileSync(tmp, pem, { mode: 0o644 });
      fs.renameSync(tmp, pubPath);
    } catch (e) {
      log.error('failed to write public key', { error: e.message });
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Best effort; a stray temp public key is inert.
      }
    }
  };

  // Adopt an existing private key. Never regenerate over one: every journal it
  // has already signed would become unverifiable, silently.
  const adopt = () => {
    const privateKeyPem = fs.readFileSync(privPath, 'utf8');
    const derivedPem = derivePublicPem(privateKeyPem);

    if (fs.existsSync(pubPath)) {
      // Distinguish a corrupt public file from a genuinely wrong one. A file we
      // cannot decode carries no information, so republishing it loses nothing.
      // A file that decodes to a different key is a real conflict and needs a
      // human, because it means signatures are being published unverifiable.
      // No initial values: every path below assigns both, and eslint's
      // no-useless-assignment flags a value that is never read.
      let onDisk;
      let raw;
      try {
        raw = fs.readFileSync(pubPath, 'utf8');
        onDisk = spki(raw);
      } catch {
        onDisk = null;
      }

      if (onDisk !== null) {
        if (onDisk !== spki(derivedPem)) {
          throw new Error(
            `signing keys do not match: ${pubPath} is not the public half of ${privPath}. ` +
              'Signatures made with this private key cannot be verified against the published ' +
              'public key. Remove the stale public file to republish it, or restore the correct pair.'
          );
        }
        return { privateKeyPem, publicKeyPem: raw };
      }
    }

    // Missing or unreadable: rebuild from the private key. Exact, not a guess.
    publishPublic(derivedPem);
    return { privateKeyPem, publicKeyPem: derivedPem };
  };

  if (fs.existsSync(privPath)) return adopt();

  if (fs.existsSync(pubPath)) {
    throw new Error(
      `signing key missing: ${pubPath} exists but ${privPath} does not. A private key cannot ` +
        'be recovered from a public one; generating a fresh pair here would invalidate ' +
        'everything already signed under the published key. Restore the private key, or ' +
        'remove the public file to deliberately start a new identity.'
    );
  }

  log.warn('no signing keys found, generating new persistent pair');
  const { privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  // Create the key atomically *with its contents already in place*. Opening the
  // destination with 'wx' is not enough: that creates an empty file first, so a
  // concurrent starter can observe the path existing and read a truncated key.
  // Writing to a private temp file and hard-linking it into position makes the
  // key appear complete or not at all, and link() fails rather than clobbering,
  // so exactly one starter wins and the rest adopt its key.
  const tmpPath = `${privPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, privateKey, { mode: 0o600 });
    try {
      fs.linkSync(tmpPath, privPath);
    } catch (e) {
      if (e.code !== 'EEXIST') {
        throw new Error(`failed to persist signing key at ${privPath}: ${e.message}`, { cause: e });
      }
      // Lost the race; the winner's key is already in place and is adopted below.
    }
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best effort: a leftover temp key is inert, and failing here would mask
      // whatever the caller actually needs to know.
    }
  }

  return adopt();
}

export function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * LRUMap is a simple Map-like object with a fixed capacity.
 * When the capacity is reached, the least recently used entry is removed.
 */
export class LRUMap extends Map {
  constructor(limit) {
    super();
    this.limit = limit;
  }

  set(key, value) {
    super.delete(key);
    super.set(key, value);
    if (this.size > this.limit) {
      const firstKey = this.keys().next().value;
      super.delete(firstKey);
    }
    return this;
  }

  get(key) {
    const value = super.get(key);
    if (value !== undefined) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  add(key) {
    return this.set(key, true);
  }
}
