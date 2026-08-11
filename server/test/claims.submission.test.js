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
