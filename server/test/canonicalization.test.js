import { describe, it, expect } from 'vitest';
import { canonicalizeSorted, canonicalizeJCS } from '../utils.js';

// What these tests are for, and what they used to be.
//
// `server/utils.js` defines `canonicalizeJCS(v)` as `return canonicalizeJcsLib(v)`.
// The previous tests here asserted:
//
//   expect(canonicalizeJCS(obj)).toEqual(canonicalizeJcsLib(obj));
//
// which expands to `lib(x) === lib(x)`. It was a tautology: no input could make
// it fail, so it carried no information about whether db8 canonicalizes to what
// RFC 8785 specifies. The second one was titled "handles edge cases (unicode
// keys, numbers, -0, null chars)" and looped four fixtures, so a reader came
// away believing the hard cases were pinned. They were not pinned at all.
//
// The oracle here is now the specification: every `canonical` below is a literal
// string derived from RFC 8785's rules, never computed by a canonicalizer. That
// is the difference between checking the code against the spec and checking the
// code against itself, and it means these tests keep their meaning if the
// delegation to the `canonicalize` package is ever replaced by our own code.
//
// The digest of this output is what gets signed (docs/Provenance.md), so a
// disagreement with the spec is a signature-interoperability bug, not cosmetics.

// Built rather than written as an escape, so no source-level escaping question
// arises about whether the input holds one NUL or six literal characters.
const NUL = String.fromCharCode(0);

// RFC 8785 §3.2.3: members are sorted by UTF-16 code unit, and locale is
// irrelevant. The French vector is the standard demonstration -- a
// locale-aware sort puts "pêche" before "péché"; JCS must not.
const SPEC_VECTORS = [
  {
    name: 'sorts members by UTF-16 code unit and ignores locale collation',
    value: {
      peach: 'This sorting order',
      péché: 'is wrong according to French',
      pêche: 'but canonicalization MUST',
      sin: 'ignore locale'
    },
    // 'e' (U+0065) < 'é' (U+00E9) < 'ê' (U+00EA), and 'p' < 's'.
    canonical:
      '{"peach":"This sorting order","péché":"is wrong according to French",' +
      '"pêche":"but canonicalization MUST","sin":"ignore locale"}'
  },
  {
    name: 'orders digits before uppercase before lowercase, empty key first',
    value: { a: 1, A: 2, 111: 3, 10: 4, 1: 5, '': 6 },
    // '' < '1' < '10' < '111' < 'A' < 'a'. "10" precedes "111" because
    // '0' (U+0030) < '1' (U+0031) at the second code unit -- it is not numeric
    // ordering, which would also give 10 < 111 and hide the distinction.
    canonical: '{"":6,"1":5,"10":4,"111":3,"A":2,"a":1}'
  },
  {
    name: 'sorts an astral-plane key after an ASCII one, by leading surrogate',
    value: { '𝄞': 'G-Clef', normal: 'value' },
    // U+1D11E is the surrogate pair D834 DD1E. The comparison is on code
    // units, so the key sorts by 0xD834 -- after 'n' (U+006E), not before it
    // as a naive code-point or byte comparison of the UTF-8 form might give.
    canonical: '{"normal":"value","𝄞":"G-Clef"}'
  },
  {
    name: 'serializes numbers as ECMAScript would, dropping the sign of -0',
    value: { a: 56.0, b: 1e-3, c: -0, d: 1e21, e: 3.14159 },
    // RFC 8785 §3.2.2.3 defers to ECMAScript Number::toString: no trailing
    // ".0", no exponent until 1e21, and -0 loses its sign.
    canonical: '{"a":56,"b":0.001,"c":0,"d":1e+21,"e":3.14159}'
  },
  {
    name: 'escapes only what JSON requires, leaving other characters literal',
    value: { a: 'a b', b: 'tab\there', c: 'nl\nhere', d: 'q"and\\bs', e: 'nul' + NUL + 'end' },
    // RFC 8785 §3.2.2.2: two-character escapes where they exist, \u00xx for
    // remaining control characters, and everything else verbatim -- so the
    // space stays a space and no character is gratuitously \u-escaped.
    canonical:
      '{"a":"a b","b":"tab\\there","c":"nl\\nhere","d":"q\\"and\\\\bs","e":"nul\\u0000end"}'
  }
];

// Deterministic, not sampled: every ordering of the keys, so "regardless of key
// order" is discharged over the whole permutation set rather than one swap.
// Ambient randomness would make a failure unreproducible (E3).
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}

const reorder = (keys, source) => Object.fromEntries(keys.map((k) => [k, source[k]]));

describe('JCS canonicalization conforms to RFC 8785', () => {
  it.each(SPEC_VECTORS)('$name', ({ value, canonical }) => {
    expect(canonicalizeJCS(value)).toBe(canonical);
  });

  // A13: an enumeration that cannot distinguish "all vectors passed" from "the
  // list was empty" is vacuous, so the population is asserted too.
  it('checks every vector the spec table declares', () => {
    expect(SPEC_VECTORS, 'spec vector table must not be empty').toHaveLength(5);
  });

  it('produces output that parses back to the value it was given', () => {
    const vector = SPEC_VECTORS[0];
    expect(JSON.parse(canonicalizeJCS(vector.value))).toEqual(vector.value);
  });

  it('is idempotent: re-canonicalizing parsed output changes nothing', () => {
    const once = canonicalizeJCS(SPEC_VECTORS[3].value);
    expect(canonicalizeJCS(JSON.parse(once))).toBe(once);
  });
});

describe('sorted canonicalization is insensitive to key order', () => {
  const NESTED = { d: { z: 1, a: [{ y: 2, x: 3 }] }, b: 'two', a: null, c: [1, 2] };
  const KEYS = ['a', 'b', 'c', 'd'];
  const EXPECTED = '{"a":null,"b":"two","c":[1,2],"d":{"a":[{"x":3,"y":2}],"z":1}}';

  it('yields one canonical form for all 24 orderings of a nested object', () => {
    const orderings = permutations(KEYS);
    expect(orderings, 'all permutations of four keys').toHaveLength(24);

    const forms = new Set(orderings.map((keys) => canonicalizeSorted(reorder(keys, NESTED))));
    expect([...forms], `24 key orderings produced ${forms.size} distinct canonical forms`).toEqual([
      EXPECTED
    ]);
  });

  // The historical bug: nested objects were left in insertion order while only
  // the top level was sorted, so this passed for {x,y} and failed for anything
  // with depth. The literal above pins the nested ordering explicitly.
  it('sorts keys at every depth, not only the top level', () => {
    expect(canonicalizeSorted({ b: { z: 1, a: 2 } })).toBe('{"b":{"a":2,"z":1}}');
    expect(canonicalizeSorted({ a: [{ y: 1, x: 2 }] })).toBe('{"a":[{"x":2,"y":1}]}');
  });

  // KNOWN DIVERGENCE, recorded deliberately -- this is change detection, not a
  // specification, and the behaviour below is not the behaviour we want.
  // Decision and rejected alternatives: docs/adr/0002-record-sorted-canonicalization-divergence.md
  //
  // `canonicalizeSorted` does `for (const k of Object.keys(v).sort())`, which
  // looks like it emits lexicographic order. It does not. An integer-like key
  // is an array index to JavaScript, and integer-index properties are emitted
  // first, in ascending NUMERIC order, whatever order they were assigned in.
  // The `.sort()` is silently overridden for that whole class of key, so
  // "sorted" mode emits {"2":..,"10":..} where a lexicographic sort -- and JCS
  // -- both emit {"10":..,"2":..}.
  //
  // This is reachable: a claim term's `object` is arbitrary JSON, so numeric
  // string keys reach the canonicalizer and therefore the signed digest.
  //
  // It is NOT a signing-correctness bug here, because the ordering is still
  // deterministic (asserted directly below) so db8 always agrees with itself.
  // It is an interoperability bug: any independent implementation of `sorted`
  // that does a real lexicographic sort computes a different digest for the
  // same document and fails verification -- the same class of divergence that
  // already shipped once between the CLI and the server.
  //
  // Deliberately left failing-forward rather than "fixed" here: changing it
  // changes every signature over a document with numeric keys.
  it('emits integer-like keys in numeric order, diverging from lexicographic', () => {
    expect(canonicalizeSorted(JSON.parse('{"2":"two","10":"ten"}'))).toBe('{"2":"two","10":"ten"}');
    expect(canonicalizeJCS(JSON.parse('{"2":"two","10":"ten"}'))).toBe('{"10":"ten","2":"two"}');
  });

  // The guarantee that actually carries the signing weight, stated on its own
  // so it cannot be lost if the divergence above is ever resolved.
  it('is deterministic for integer-like keys however they were inserted', () => {
    const a = JSON.parse('{"2":"two","10":"ten","x":1}');
    const b = JSON.parse('{"x":1,"10":"ten","2":"two"}');
    expect(canonicalizeSorted(a)).toBe(canonicalizeSorted(b));
  });

  it('preserves array order, which carries meaning that key order does not', () => {
    expect(canonicalizeSorted({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });
});
