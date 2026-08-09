import { describe, it, expect } from 'vitest';
import {
  validateTerm,
  canonicalTerm,
  termHash,
  FRAME_KINDS,
  TRANSPARENT_FRAMES
} from '../claims/terms.js';
import { pathsOf, atPath, formatPath } from '../claims/paths.js';
import { checkableClaims } from '../claims/checkable.js';

const named = (name) => ({ kind: 'named', name });
const prop = (subject, predicate, object) => ({
  kind: 'claim',
  subject: named(subject),
  predicate,
  object
});

const REMOTE_WORK = prop('remote_work', 'reduces', 'productivity');
const SHIPS_TUESDAY = prop('release', 'ships_on', 'tuesday');

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

  it('resolves the root, the frame node, and the inner proposition', () => {
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
});
