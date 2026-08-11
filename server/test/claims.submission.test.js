import { describe, it, expect } from 'vitest';
import { SubmissionIn, Claim } from '../schemas.js';

// The cutover: a claim's assertion is a ClaimTerm, not a text string.
//
// `id` and `support` are unchanged — they are orthogonal to term structure, and
// replacing the evidence model is explicitly a non-goal in docs/specs/ClaimTerms.md.
// Only `text` is replaced, by `term`.

const named = (name) => ({ kind: 'named', name });
const proposition = {
  kind: 'claim',
  subject: named('remote_work'),
  predicate: 'reduces',
  object: 'productivity'
};

const claim = (term) => ({
  id: 'c1',
  term,
  support: [{ kind: 'logic', ref: 'a' }]
});

const submission = (claims) => ({
  room_id: '00000000-0000-0000-0000-000000000001',
  round_id: '00000000-0000-0000-0000-000000000002',
  author_id: '00000000-0000-0000-0000-000000000003',
  phase: 'submit',
  deadline_unix: 0,
  content: 'body',
  claims,
  citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
  client_nonce: 'nonce-claim-term-1'
});

describe('Claim carries a term', () => {
  it('accepts a structured term', () => {
    expect(Claim.safeParse(claim(proposition)).success).toBe(true);
  });

  it('keeps id and support alongside the term', () => {
    const parsed = Claim.parse(claim(proposition));
    expect(parsed.id).toBe('c1');
    expect(parsed.support).toHaveLength(1);
    expect(parsed.term.kind).toBe('claim');
  });

  it('rejects the legacy flat text shape outright', () => {
    // Clean cutover: no dual-accept. Half-structured data is exactly the
    // comparability problem structured claims exist to solve.
    const legacy = { id: 'c1', text: 'Claim', support: [{ kind: 'logic', ref: 'a' }] };
    expect(Claim.safeParse(legacy).success).toBe(false);
  });

  it('rejects a malformed term', () => {
    expect(Claim.safeParse(claim({ kind: 'implies', body: proposition })).success).toBe(false);
  });

  it('still requires at least one support entry', () => {
    expect(Claim.safeParse({ id: 'c1', term: proposition, support: [] }).success).toBe(false);
  });
});

describe('SubmissionIn carries structured claims', () => {
  it('accepts a submission whose claims are terms', () => {
    const r = SubmissionIn.safeParse(submission([claim(proposition)]));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts the full constructor range, including concession', () => {
    const terms = [
      { kind: 'framed', frame: { kind: 'belief', holder: named('opponent') }, body: proposition },
      { kind: 'either', options: [proposition, { ...proposition, predicate: 'raises' }] },
      { kind: 'concession', even_if: proposition, still: { ...proposition, predicate: 'raises' } }
    ];
    for (const term of terms) {
      const r = SubmissionIn.safeParse(submission([claim(term)]));
      expect(r.success, `${term.kind}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });

  it('rejects a submission still sending flat claims', () => {
    const legacy = { id: 'c1', text: 'Claim', support: [{ kind: 'logic', ref: 'a' }] };
    expect(SubmissionIn.safeParse(submission([legacy])).success).toBe(false);
  });

  it('keeps the existing 1..5 claim bounds', () => {
    expect(SubmissionIn.safeParse(submission([])).success).toBe(false);
    const six = Array.from({ length: 6 }, () => claim(proposition));
    expect(SubmissionIn.safeParse(submission(six)).success).toBe(false);
  });
});

// The submission path is the only gate that matters. Wiring `term` to the bare
// ClaimTerm schema meant every guard validateTerm adds — the depth and size
// caps, the __proto__ refusal, either distinctness, temporal anchoring — was
// enforced nowhere a real submission passes through.
describe('the submission path enforces validateTerm, not just the schema', () => {
  const P = { kind: 'claim', subject: named('a'), predicate: 'is_true', object: null };
  const nest = (depth) => {
    let t = P;
    for (let i = 0; i < depth; i += 1) t = { kind: 'denial', body: t };
    return t;
  };

  const hostile = {
    'over the depth cap': nest(20),
    'wide scalar payload': {
      kind: 'claim',
      subject: named('x'),
      predicate: 'has',
      object: new Array(2000).fill(0)
    },
    '__proto__ payload': {
      kind: 'claim',
      subject: named('x'),
      predicate: 'has',
      object: JSON.parse('{"__proto__":{"a":1}}')
    },
    'duplicate either options': { kind: 'either', options: [P, P] },
    'unanchored temporal frame': { kind: 'framed', frame: { kind: 'temporal' }, body: P }
  };

  // Control: a valid term must still pass, or the cases below prove nothing.
  it('still accepts a valid submission', () => {
    expect(SubmissionIn.safeParse(submission([claim(proposition)])).success).toBe(true);
  });

  for (const [label, term] of Object.entries(hostile)) {
    it(`rejects ${label}`, () => {
      expect(SubmissionIn.safeParse(submission([claim(term)])).success).toBe(false);
    });
  }

  // Zod recurses through the term as it parses. Without the pre-check that
  // measure() performs, a deep enough term exhausts the stack inside the
  // validator instead of returning a validation failure.
  it('reports a validation failure for a term deep enough to exhaust the stack', () => {
    const result = SubmissionIn.safeParse(submission([claim(nest(10000))]));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error.issues)).not.toMatch(/call stack/i);
  });
});
