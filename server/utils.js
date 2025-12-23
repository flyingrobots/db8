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
    const out = {};
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

  try {
    if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
      return {
        privateKeyPem: fs.readFileSync(privPath, 'utf8'),
        publicKeyPem: fs.readFileSync(pubPath, 'utf8')
      };
    }
  } catch (e) {
    log.error('failed to read keys', { error: e.message });
  }

  // Generate and save
  log.warn('no signing keys found, generating new persistent pair');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  try {
    const fd = fs.openSync(privPath, 'w', 0o600);
    fs.writeFileSync(fd, privateKey);
    fs.closeSync(fd);
    fs.writeFileSync(pubPath, publicKey);
  } catch (e) {
    log.error('failed to save keys', { error: e.message });
  }

  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
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
