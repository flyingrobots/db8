import { describe, it, expect } from 'vitest';
import {
  validateTerm,
  canonicalTerm,
  termHash,
  predicatesOf,
  FRAME_KINDS,
  TRANSPARENT_FRAMES,
  MAX_DEPTH,
  MAX_NODES
} from '../claims/terms.js';
import { pathsOf, atPath, formatPath, parsePath } from '../claims/paths.js';
import { canonicalizeSorted } from '../utils.js';
import { checkableClaims, assertsNothing } from '../claims/checkable.js';

const named = (name) => ({ kind: 'named', name });
const prop = (subject, predicate, object) => ({
  kind: 'claim',
  subject: named(subject),
  predicate,
  object
});

const REMOTE_WORK = prop('remote_work', 'reduces', 'productivity');
const SHIPS_TUESDAY = prop('release', 'ships_on', 'tuesday');

// Env mutation is restored even when the body throws, so one failing
// expectation cannot leak a canonicalization mode into unrelated tests.
function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('claim terms — shape', () => {
  it('accepts every node kind', () => {
    const terms = [
      REMOTE_WORK,
      { kind: 'framed', frame: { kind: 'belief', holder: named('opponent') }, body: REMOTE_WORK },
      { kind: 'all', parts: [REMOTE_WORK, SHIPS_TUESDAY] },
      { kind: 'either', options: [REMOTE_WORK, SHIPS_TUESDAY] },
      { kind: 'denial', body: REMOTE_WORK },
      { kind: 'conditional', when: SHIPS_TUESDAY, then: REMOTE_WORK },
      { kind: 'concession', even_if: SHIPS_TUESDAY, still: REMOTE_WORK }
    ];
    for (const t of terms) {
      const r = validateTerm(t);
      expect(r.ok, `${t.kind}: ${JSON.stringify(r.errors)}`).toBe(true);
    }
  });

  it('rejects an unknown node kind', () => {
    expect(validateTerm({ kind: 'implies', body: REMOTE_WORK }).ok).toBe(false);
  });

  it('requires either to hold at least two options', () => {
    const r = validateTerm({ kind: 'either', options: [REMOTE_WORK] });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.errors)).toMatch(/two/i);
  });

  it('requires all to hold at least one part', () => {
    expect(validateTerm({ kind: 'all', parts: [] }).ok).toBe(false);
  });

  it('rejects an unknown frame kind', () => {
    const t = { kind: 'framed', frame: { kind: 'vibes' }, body: REMOTE_WORK };
    expect(validateTerm(t).ok).toBe(false);
  });

  it('rejects a frame missing its required field', () => {
    const t = { kind: 'framed', frame: { kind: 'belief' }, body: REMOTE_WORK };
    expect(validateTerm(t).ok).toBe(false);
  });

  it('rejects non-finite numbers in an object payload', () => {
    // NaN/Infinity have no JSON form; they would break canonical hashing.
    const t = prop('inflation', 'rate_is', Number.POSITIVE_INFINITY);
    expect(validateTerm(t).ok).toBe(false);
  });

  it('bounds nesting depth', () => {
    let t = REMOTE_WORK;
    for (let i = 0; i < 64; i += 1) t = { kind: 'denial', body: t };
    const r = validateTerm(t);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.errors)).toMatch(/depth/i);
  });
});

describe('claim terms — predicate vocabulary', () => {
  it('accepts a declared predicate', () => {
    const r = validateTerm(REMOTE_WORK, { predicates: ['reduces', 'ships_on'] });
    expect(r.ok).toBe(true);
  });

  it('rejects an undeclared predicate and names it', () => {
    const r = validateTerm(REMOTE_WORK, { predicates: ['ships_on'] });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.errors)).toMatch(/reduces/);
  });

  it('accepts any predicate when no vocabulary is declared', () => {
    expect(validateTerm(REMOTE_WORK).ok).toBe(true);
  });
});

describe('claim terms — non-factivity', () => {
  // The core rule: framing never entails the bare proposition.
  it('yields nothing checkable under an opaque frame', () => {
    for (const kind of FRAME_KINDS.filter((k) => !TRANSPARENT_FRAMES.includes(k))) {
      const frame = {
        attribution: { kind: 'attribution', source: named('the_study') },
        belief: { kind: 'belief', holder: named('opponent') },
        hypothetical: { kind: 'hypothetical' },
        hedge: { kind: 'hedge', expression: 'may' },
        evaluative: { kind: 'evaluative' }
      }[kind];
      // Without this, adding a frame kind and forgetting to map it here makes
      // `frame` undefined, checkableClaims returns [], and the loop reports the
      // new kind opaque without having tested it.
      expect(frame, `${kind} has no fixture`).toBeDefined();
      const t = { kind: 'framed', frame, body: REMOTE_WORK };
      expect(checkableClaims(t), `${kind} must be opaque`).toEqual([]);
    }
  });

  it('passes through a transparent frame, carrying the frame as context', () => {
    const t = {
      kind: 'framed',
      frame: { kind: 'domain', restriction: 'united_states' },
      body: REMOTE_WORK
    };
    const out = checkableClaims(t);
    expect(out).toHaveLength(1);
    expect(out[0].claim.predicate).toBe('reduces');
    expect(out[0].context).toEqual([{ kind: 'domain', restriction: 'united_states' }]);
  });

  it('does not treat a bare proposition as believed either', () => {
    // The converse of the rule: asserting p is not asserting that anyone believes p.
    const bare = checkableClaims(REMOTE_WORK);
    const believed = checkableClaims({
      kind: 'framed',
      frame: { kind: 'belief', holder: named('opponent') },
      body: REMOTE_WORK
    });
    expect(bare).toHaveLength(1);
    expect(believed).toEqual([]);
  });

  it('asserts every part of an all', () => {
    expect(checkableClaims({ kind: 'all', parts: [REMOTE_WORK, SHIPS_TUESDAY] })).toHaveLength(2);
  });

  it('asserts no option of an either', () => {
    expect(checkableClaims({ kind: 'either', options: [REMOTE_WORK, SHIPS_TUESDAY] })).toEqual([]);
  });

  it('asserts neither branch of a conditional', () => {
    expect(
      checkableClaims({ kind: 'conditional', when: SHIPS_TUESDAY, then: REMOTE_WORK })
    ).toEqual([]);
  });

  it('asserts the consequent of a concession but not the conceded premise', () => {
    // "Even if the release ships Tuesday, remote work still reduces productivity"
    // asserts the latter outright; the former is granted, not claimed.
    const out = checkableClaims({
      kind: 'concession',
      even_if: SHIPS_TUESDAY,
      still: REMOTE_WORK
    });
    expect(out).toHaveLength(1);
    expect(out[0].claim.predicate).toBe('reduces');
  });

  it('records polarity for a denial', () => {
    const out = checkableClaims({ kind: 'denial', body: REMOTE_WORK });
    expect(out).toHaveLength(1);
    expect(out[0].polarity).toBe('deny');
    expect(checkableClaims(REMOTE_WORK)[0].polarity).toBe('affirm');
  });

  it('reports the path of each checkable proposition', () => {
    const t = { kind: 'all', parts: [REMOTE_WORK, { kind: 'denial', body: SHIPS_TUESDAY }] };
    const out = checkableClaims(t);
    expect(out.map((c) => formatPath(c.path))).toEqual(['$.parts[0]', '$.parts[1].body']);
  });
});

describe('claim terms — denial does not distribute over a conjunction', () => {
  // "not (A and B)" entails only that at least one conjunct fails. Emitting a
  // denial of each would hand the verifier two claims the author never made.
  it('yields nothing checkable for a denied conjunction', () => {
    const term = { kind: 'denial', body: { kind: 'all', parts: [REMOTE_WORK, SHIPS_TUESDAY] } };
    expect(validateTerm(term).ok).toBe(true);
    expect(checkableClaims(term)).toEqual([]);
  });

  it('still denies a single proposition under a denial', () => {
    const term = { kind: 'denial', body: REMOTE_WORK };
    expect(checkableClaims(term).map((c) => c.polarity)).toEqual(['deny']);
  });

  it('affirms a doubly denied conjunction, since the polarity is back to affirm', () => {
    const inner = { kind: 'all', parts: [REMOTE_WORK, SHIPS_TUESDAY] };
    const term = { kind: 'denial', body: { kind: 'denial', body: inner } };
    expect(checkableClaims(term).map((c) => c.polarity)).toEqual(['affirm', 'affirm']);
  });
});

describe('claim terms — assertsNothing', () => {
  it('is true when every proposition sits behind a disjunction', () => {
    expect(assertsNothing({ kind: 'either', options: [REMOTE_WORK, SHIPS_TUESDAY] })).toBe(true);
  });

  it('is false for a bare proposition', () => {
    expect(assertsNothing(REMOTE_WORK)).toBe(false);
  });

  // "the study says P" suppresses P, but whether the study said it is itself
  // falsifiable — and it is the exact outer-node finding claim paths exist for.
  it('is false for an attribution, whose relation is checkable even though P is not', () => {
    const term = {
      kind: 'framed',
      frame: { kind: 'attribution', source: named('the_study') },
      body: REMOTE_WORK
    };
    expect(checkableClaims(term)).toEqual([]);
    expect(assertsNothing(term)).toBe(false);
  });

  it('is false for a belief, for the same reason', () => {
    const term = {
      kind: 'framed',
      frame: { kind: 'belief', holder: named('opponent') },
      body: REMOTE_WORK
    };
    expect(assertsNothing(term)).toBe(false);
  });

  // Projection stops at every either, so `either([P, P])` would let an author
  // assert P while presenting it as an unresolved choice.
  it('rejects an either whose options are all the same term', () => {
    expect(validateTerm({ kind: 'either', options: [REMOTE_WORK, REMOTE_WORK] }).ok).toBe(false);
    expect(validateTerm({ kind: 'either', options: [REMOTE_WORK, SHIPS_TUESDAY] }).ok).toBe(true);
  });

  // Every case above answers at depth zero. These reach the descent, which is
  // the part that can actually break: the CHILD_KEYS loop and its list handling.
  const ATTRIBUTED = {
    kind: 'framed',
    frame: { kind: 'attribution', source: named('the_study') },
    body: REMOTE_WORK
  };

  it('finds an attribution buried in an asserted list slot', () => {
    // Both parts of an affirmed conjunction are asserted, so the attribution
    // relation inside one of them is too.
    const term = { kind: 'all', parts: [ATTRIBUTED, SHIPS_TUESDAY] };
    expect(assertsNothing(term)).toBe(false);
  });

  it('finds an attribution buried in an asserted non-list slot', () => {
    const term = { kind: 'concession', even_if: SHIPS_TUESDAY, still: ATTRIBUTED };
    expect(assertsNothing(term)).toBe(false);
  });

  // An opaque ancestor suspends everything beneath it, including a relational
  // frame. "Suppose the study says P" asserts neither P nor that the study
  // said it.
  it('is true when an attribution sits under an opaque frame', () => {
    const term = { kind: 'framed', frame: { kind: 'hypothetical' }, body: ATTRIBUTED };
    expect(checkableClaims(term)).toEqual([]);
    expect(assertsNothing(term)).toBe(true);
  });

  it('is true when an attribution sits in an unasserted branch', () => {
    expect(assertsNothing({ kind: 'either', options: [ATTRIBUTED, SHIPS_TUESDAY] })).toBe(true);
    expect(assertsNothing({ kind: 'conditional', when: ATTRIBUTED, then: SHIPS_TUESDAY })).toBe(
      true
    );
    expect(assertsNothing({ kind: 'concession', even_if: ATTRIBUTED, still: ATTRIBUTED })).toBe(
      false
    );
  });

  it('stays true when a buried frame is opaque but not relational', () => {
    const hypo = (body) => ({ kind: 'framed', frame: { kind: 'hypothetical' }, body });
    const buried = { kind: 'either', options: [hypo(REMOTE_WORK), hypo(SHIPS_TUESDAY)] };
    const term = { kind: 'conditional', when: buried, then: hypo(REMOTE_WORK) };
    expect(validateTerm(term).ok).toBe(true);
    expect(assertsNothing(term)).toBe(true);
  });

  it('is true for a hypothetical, which attributes the proposition to no one', () => {
    const term = { kind: 'framed', frame: { kind: 'hypothetical' }, body: REMOTE_WORK };
    expect(assertsNothing(term)).toBe(true);
  });
});

describe('claim terms — denial does not distribute over a concession', () => {
  // "Even if X, Y still holds" asserts Y and grants X. Denying it rejects the
  // concessive relation - X may well defeat Y - so it does not entail not-Y.
  it('yields nothing checkable for a denied concession', () => {
    const term = {
      kind: 'denial',
      body: { kind: 'concession', even_if: SHIPS_TUESDAY, still: REMOTE_WORK }
    };
    expect(validateTerm(term).ok).toBe(true);
    expect(checkableClaims(term)).toEqual([]);
  });

  it('still asserts the consequent when the concession is affirmed', () => {
    const term = { kind: 'concession', even_if: SHIPS_TUESDAY, still: REMOTE_WORK };
    expect(checkableClaims(term).map((c) => c.polarity)).toEqual(['affirm']);
  });
});

describe('claim terms — payload size', () => {
  // Every payload value counts, not just containers. A wide array of scalars
  // passed the node cap while Zod and canonicalization still had to walk all
  // of it.
  it('rejects a payload with more scalar elements than the node cap', () => {
    const wide = prop('x', 'has', new Array(MAX_NODES * 4).fill(0));
    const result = validateTerm(wide);
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/exceeds maximum size/);
  });

  it('still accepts a payload comfortably inside the cap', () => {
    expect(validateTerm(prop('x', 'has', new Array(8).fill(0))).ok).toBe(true);
    expect(validateTerm(prop('x', 'has', { a: 1, b: 'two', c: [3, 4] })).ok).toBe(true);
  });

  it('returns promptly for a very wide payload instead of walking all of it', () => {
    const huge = prop('x', 'has', new Array(1_000_000).fill(0));
    const started = Date.now();
    expect(validateTerm(huge).ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe('claim terms — all vs either are distinguishable', () => {
  it('hashes a conjunction and a disjunction differently', () => {
    const conjunction = { kind: 'all', parts: [REMOTE_WORK, SHIPS_TUESDAY] };
    const disjunction = { kind: 'either', options: [REMOTE_WORK, SHIPS_TUESDAY] };
    expect(termHash(conjunction)).not.toBe(termHash(disjunction));
  });

  it('preserves order, so a reordered conjunction is a different term', () => {
    const a = { kind: 'all', parts: [REMOTE_WORK, SHIPS_TUESDAY] };
    const b = { kind: 'all', parts: [SHIPS_TUESDAY, REMOTE_WORK] };
    expect(termHash(a)).not.toBe(termHash(b));
  });

  it('distinguishes frame order', () => {
    const inner = REMOTE_WORK;
    const believedReported = {
      kind: 'framed',
      frame: { kind: 'attribution', source: named('the_study') },
      body: { kind: 'framed', frame: { kind: 'belief', holder: named('opponent') }, body: inner }
    };
    const reportedBelieved = {
      kind: 'framed',
      frame: { kind: 'belief', holder: named('opponent') },
      body: {
        kind: 'framed',
        frame: { kind: 'attribution', source: named('the_study') },
        body: inner
      }
    };
    expect(termHash(believedReported)).not.toBe(termHash(reportedBelieved));
  });

  it('produces a stable canonical form regardless of key insertion order', () => {
    const a = { kind: 'claim', subject: named('x'), predicate: 'p', object: 'o' };
    const b = { object: 'o', predicate: 'p', subject: named('x'), kind: 'claim' };
    expect(canonicalTerm(a)).toBe(canonicalTerm(b));
    expect(termHash(a)).toBe(termHash(b));
  });
});

describe('claim terms — path addressing for verdicts', () => {
  const term = {
    kind: 'framed',
    frame: { kind: 'attribution', source: named('the_study') },
    body: REMOTE_WORK
  };

  it('resolves the root and the inner proposition', () => {
    expect(atPath(term, [])).toBe(term);
    expect(atPath(term, ['body'])).toBe(REMOTE_WORK);
  });

  it('lets a verdict target the attribution and the proposition separately', () => {
    // "the study does not say that" vs "the study says it and is wrong"
    const outer = [];
    const inner = ['body'];
    expect(formatPath(outer)).toBe('$');
    expect(formatPath(inner)).toBe('$.body');
    expect(atPath(term, outer).kind).toBe('framed');
    expect(atPath(term, inner).kind).toBe('claim');
  });

  it('enumerates every addressable node', () => {
    const t = { kind: 'conditional', when: SHIPS_TUESDAY, then: REMOTE_WORK };
    expect(pathsOf(t).map(formatPath)).toEqual(['$', '$.when', '$.then']);
  });

  it('returns undefined for a path that does not resolve', () => {
    expect(atPath(term, ['parts', 0])).toBeUndefined();
    expect(atPath(term, ['body', 'body'])).toBeUndefined();
  });

  // parsePath signals failure with null. Letting that reach atPath as "no steps"
  // would resolve the root, so a malformed verdict path would silently rule on
  // the whole term instead of being rejected.
  it('rejects a null path rather than resolving the root', () => {
    expect(parsePath('$.bogus[')).toBeNull();
    expect(atPath(term, parsePath('$.bogus['))).toBeUndefined();
    expect(atPath(term, null)).toBeUndefined();
  });

  it('round-trips every enumerated path through formatPath and parsePath', () => {
    const t = {
      kind: 'all',
      parts: [{ kind: 'denial', body: REMOTE_WORK }, SHIPS_TUESDAY]
    };
    for (const path of pathsOf(t)) {
      expect(parsePath(formatPath(path))).toEqual(path);
      expect(atPath(t, parsePath(formatPath(path)))).toBe(atPath(t, path));
    }
  });

  it('rejects malformed path strings', () => {
    for (const bad of ['', 'body', '$..body', '$.parts[]', '$.parts[0', '$[0]x', '$.']) {
      expect(parsePath(bad)).toBeNull();
    }
  });

  it('treats the empty path as the root and nothing else', () => {
    expect(parsePath('$')).toEqual([]);
    expect(atPath(term, [])).toBe(term);
  });
});

describe('claim terms — validation boundaries', () => {
  const nest = (depth) => {
    let t = REMOTE_WORK;
    for (let i = 0; i < depth; i += 1) t = { kind: 'denial', body: t };
    return t;
  };

  // The error says "exceeds", so reaching the cap must be legal. MAX_NODES uses
  // the same convention and the two must not disagree on their own boundary.
  it('accepts exactly MAX_DEPTH levels of nesting and rejects one more', () => {
    expect(validateTerm(nest(MAX_DEPTH)).ok).toBe(true);
    const over = validateTerm(nest(MAX_DEPTH + 1));
    expect(over.ok).toBe(false);
    expect(over.errors[0].message).toMatch(/exceeds maximum nesting depth/);
  });

  it('accepts exactly MAX_NODES nodes and rejects one more', () => {
    const conj = (n) => ({
      kind: 'all',
      parts: Array.from({ length: n }, () => REMOTE_WORK)
    });
    expect(validateTerm(conj(MAX_NODES - 1)).ok).toBe(true);
    const over = validateTerm(conj(MAX_NODES));
    expect(over.ok).toBe(false);
    expect(over.errors[0].message).toMatch(/exceeds maximum size/);
  });

  // A claim payload is arbitrary JSON, and measure() stops at claim nodes. If the
  // payload is not counted, a deep enough one exhausts the stack in Zod instead of
  // returning a validation error.
  it('bounds nesting inside a claim payload instead of overflowing the stack', () => {
    let deep = 1;
    for (let i = 0; i < 50_000; i += 1) deep = [deep];
    const result = validateTerm(prop('x', 'has', deep));
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/exceeds maximum/);
  });
});

describe('claim terms — claim payloads', () => {
  const RECORD_PAYLOAD = prop('report', 'contains', { pages: 12, title: 'findings' });
  const ARRAY_PAYLOAD = prop('report', 'lists', ['a', 'b', 3]);
  const ENTITY_PAYLOAD = prop('report', 'authored_by', {
    kind: 'entity',
    value: named('the_study')
  });

  it('accepts record, array, and entity-reference payloads', () => {
    for (const term of [RECORD_PAYLOAD, ARRAY_PAYLOAD, ENTITY_PAYLOAD]) {
      expect(validateTerm(term).ok).toBe(true);
    }
  });

  // z.union takes the first member that parses. Without an explicit rejection a
  // malformed entity matches the generic record branch and persists as a record
  // wearing an entity badge — and terms are stored as authored.
  it('rejects a record that claims the entity discriminator but is not one', () => {
    const bad = prop('report', 'authored_by', { kind: 'entity', value: 'the_study' });
    expect(validateTerm(bad).ok).toBe(false);
  });

  // The guard is `o.kind !== 'entity'`. Widen it to `!('kind' in o)` - a
  // plausible tightening - and every record carrying a `kind` field starts
  // failing. A rejection test alone pins one point, not the boundary.
  it('still accepts a record whose kind is anything other than entity', () => {
    for (const kind of ['section', 'entity_ref', 'ENTITY', '']) {
      const term = prop('report', 'contains', { kind, value: 'x' });
      expect(validateTerm(term).ok, `kind=${JSON.stringify(kind)}`).toBe(true);
    }
  });
});

describe('claim terms — content addressing', () => {
  it('lists every predicate in sorted order', () => {
    const term = {
      kind: 'all',
      parts: [SHIPS_TUESDAY, REMOTE_WORK, prop('team', 'adopted', 'remote_work')]
    };
    expect(predicatesOf(term)).toEqual(['adopted', 'reduces', 'ships_on']);
  });

  it('refuses to content-address a term that would not validate', () => {
    expect(() => termHash({ kind: 'claim', predicate: 'BAD CASE' })).toThrow();
  });

  // Zod's record parser drops `__proto__`, so a payload carrying it would come
  // back from validation mutated — and a term that hashes to an address its own
  // authored form does not produce is not content-addressed at all.
  it('rejects a __proto__ payload rather than silently dropping it', () => {
    const withProto = prop('x', 'has', JSON.parse('{"__proto__":{"a":1}}'));
    const result = validateTerm(withProto);
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/reserved key/);
  });

  it('rejects a __proto__ key nested inside a payload', () => {
    const nested = prop('x', 'has', { outer: [JSON.parse('{"__proto__":1}')] });
    expect(validateTerm(nested).ok).toBe(false);
  });

  // Independent of the above: the sorted canonicalizer must not conflate a key it
  // is given with one it was not, or two distinct values share one address.
  // Named exactly, because `!== '{}'` also passes for outputs that still lose
  // the value - `{"__proto__":null}` or `{"__proto__":{}}`.
  it('preserves a __proto__ key and its value through the sorted canonicalizer', () => {
    expect(canonicalizeSorted(JSON.parse('{"__proto__":{"a":1}}'))).toBe('{"__proto__":{"a":1}}');
  });

  it('keeps a __proto__ key distinct from a sibling in the sorted canonicalizer', () => {
    expect(canonicalizeSorted(JSON.parse('{"__proto__":1,"a":2}'))).toBe('{"__proto__":1,"a":2}');
  });

  // config-builder rejects an unknown CANON_MODE. Silently falling back to jcs
  // here would let a typo change what gets signed without anyone noticing.
  it('rejects an unrecognized canonicalization mode instead of falling back', () => {
    withEnv({ CANON_MODE: 'sorted_v2' }, () => {
      expect(() => canonicalTerm(REMOTE_WORK)).toThrow(/CANON_MODE/);
    });
  });

  // Claim terms are signing-adjacent. The server canonicalizes through the
  // validated CANON_MODE that config-builder enforces; DB8_CANON_MODE is a CLI
  // alias and must not move server hashes off that path.
  //
  // Mode selection is asserted through validation rather than through output,
  // deliberately: `sorted` and `jcs` produce byte-identical results for every
  // payload a claim term can hold, so comparing canonical strings would pass no
  // matter which mode were selected. Which variable is *read* is observable;
  // which canonicalizer runs is not.
  it('ignores an invalid mode smuggled in through DB8_CANON_MODE', () => {
    withEnv({ CANON_MODE: 'jcs', DB8_CANON_MODE: 'sorted_v2' }, () => {
      expect(() => canonicalTerm(REMOTE_WORK)).not.toThrow();
    });
  });

  it('still rejects that same invalid mode when it comes from CANON_MODE', () => {
    withEnv({ CANON_MODE: 'sorted_v2', DB8_CANON_MODE: undefined }, () => {
      expect(() => canonicalTerm(REMOTE_WORK)).toThrow(/CANON_MODE/);
    });
  });
});

describe('claim terms — error paths vs verdict paths', () => {
  // Two different grammars, and the spec has to say so. Verdict paths name
  // nodes and must resolve. Validation error paths are diagnostics and may name
  // a field inside a node — Zod reports `$.predicate`, `$.object`,
  // `$.subject.name`, none of which are addressable. Pinning this stops the
  // stricter frame behaviour from being mistaken for a universal guarantee.
  const cases = [
    {
      label: 'bad frame kind',
      term: { kind: 'framed', frame: { kind: 'vibes' }, body: REMOTE_WORK }
    },
    { label: 'non-finite payload', term: prop('inflation', 'rate_is', Number.POSITIVE_INFINITY) },
    { label: 'bad predicate', term: prop('x', 'BAD CASE', null) }
  ];

  it('emits field-level error paths that do not resolve as nodes', () => {
    for (const { label, term } of cases) {
      const result = validateTerm(term);
      expect(result.ok, label).toBe(false);
      // Documented as diagnostics, not verdict targets.
      expect(atPath(term, parsePath(result.errors[0].path)), label).toBeUndefined();
    }
  });

  it('enumerates only addressable nodes for verdicts', () => {
    const term = {
      kind: 'framed',
      frame: { kind: 'attribution', source: named('the_study') },
      body: REMOTE_WORK
    };
    for (const path of pathsOf(term)) {
      expect(atPath(term, path)).toBeDefined();
    }
  });
});

describe('claim terms — temporal frame errors are addressable', () => {
  // Every path db8 hands out must resolve, because a verdict may be filed against
  // it. `frame` is not a declared child slot, so the error belongs on the framed
  // node that owns it.
  it('reports a bad temporal frame at a path that atPath can resolve', () => {
    const term = {
      kind: 'all',
      parts: [SHIPS_TUESDAY, { kind: 'framed', frame: { kind: 'temporal' }, body: REMOTE_WORK }]
    };
    const result = validateTerm(term);
    expect(result.ok).toBe(false);

    const [error] = result.errors;
    expect(error.message).toMatch(/temporal frame requires/);
    const resolved = atPath(term, parsePath(error.path));
    expect(resolved).toBeDefined();
    expect(resolved.kind).toBe('framed');
  });
});
