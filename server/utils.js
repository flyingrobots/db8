import crypto from 'node:crypto';
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

export function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
