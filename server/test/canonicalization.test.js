import { describe, it, expect } from 'vitest';
import { canonicalizeSorted, canonicalizeJCS } from '../utils.js';
import canonicalizeJcsLib from 'canonicalize';

describe('canonical JSON hashing', () => {
  it('sorted canonicalization is stable regardless of key order', () => {
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    expect(canonicalizeSorted(a)).toEqual(canonicalizeSorted(b));
  });

  it('JCS canonicalization matches reference implementation', () => {
    const obj = {
      z: 'last',
      a: { nested: [3, 2, 1], t: true, n: null },
      n: 123,
      s: 'x'
    };
    expect(canonicalizeJCS(obj)).toEqual(canonicalizeJcsLib(obj));
  });
});
