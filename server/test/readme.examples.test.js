import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateTerm } from '../claims/terms.js';
import { assertsNothing } from '../claims/checkable.js';

// The README teaches the claim-term model from JSON examples. An example the
// validator rejects teaches a shape no client can submit, so each claim term
// in the README must validate. The hedge example once lacked the frame's
// required `expression` while the text called it well-formed.

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const jsonBlocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
const terms = jsonBlocks.filter((block) => typeof block?.kind === 'string');

describe('README claim-term examples', () => {
  it('finds the examples it checks', () => {
    expect(terms.length).toBeGreaterThan(0);
  });

  it.each(terms.map((term, i) => [i, term]))('example %i validates', (_i, term) => {
    const result = validateTerm(term);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('shows the foil as asserting nothing', () => {
    const i = readme.indexOf('### The foil: an argument that asserts nothing');
    const start = readme.indexOf('```json\n', i) + '```json\n'.length;
    const foil = JSON.parse(readme.slice(start, readme.indexOf('```', start)));
    expect(validateTerm(foil).ok).toBe(true);
    expect(assertsNothing(foil)).toBe(true);
  });
});
