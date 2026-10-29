import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SubmissionIn } from '../schemas.js';
import { validateTerm } from '../claims/terms.js';
import { assertsNothing } from '../claims/checkable.js';

// The README teaches the claim-term model from JSON examples. An example the
// validator rejects teaches a shape no client can submit, so every JSON block
// in the README must be one this suite knows how to check, and must pass. The
// hedge example once lacked the frame's required `expression` while the text
// called it well-formed.

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m, i) => ({
  i,
  value: JSON.parse(m[1])
}));

// A block is a submission (it has `claims`) or a standalone term (it has
// `kind`). Anything else is an example this suite cannot check.
const isSubmission = (v) => Array.isArray(v?.claims);
const isTerm = (v) => typeof v?.kind === 'string';

describe('README JSON examples', () => {
  it('finds examples, and recognizes every one', () => {
    expect(blocks.length).toBeGreaterThan(0);
    const unknown = blocks.filter(({ value }) => !isSubmission(value) && !isTerm(value));
    expect(
      unknown.map(({ i }) => i),
      'JSON blocks of an unknown shape'
    ).toEqual([]);
  });

  it.each(blocks.filter(({ value }) => isSubmission(value)).map(({ i, value }) => [i, value]))(
    'submission example %i passes the submission schema, and each claim term validates',
    (_i, value) => {
      expect(() => SubmissionIn.parse(value)).not.toThrow();
      for (const claim of value.claims) {
        const result = validateTerm(claim.term);
        expect(result.errors, `claim ${claim.id}`).toEqual([]);
      }
    }
  );

  it.each(blocks.filter(({ value }) => isTerm(value)).map(({ i, value }) => [i, value]))(
    'term example %i validates',
    (_i, value) => {
      const result = validateTerm(value);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  );

  it('shows the foil as asserting nothing', () => {
    const i = readme.indexOf('### The foil: an argument that asserts nothing');
    const start = readme.indexOf('```json\n', i) + '```json\n'.length;
    const foil = JSON.parse(readme.slice(start, readme.indexOf('```', start)));
    expect(validateTerm(foil).ok).toBe(true);
    expect(assertsNothing(foil)).toBe(true);
  });
});
