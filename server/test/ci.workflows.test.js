import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// The two test passes exist to compare like with like: the same suite, run
// twice, the second time against the database the first left behind. If pass 1
// runs a smaller set than pass 2 then the extra suites are only ever exercised
// against a dirty database — never a fresh one — and the idempotency signal is
// not a comparison at all.
//
// js-yaml is a transitive dependency here rather than a declared one; if that
// ever changes these assertions should move to raw-text matching rather than
// pulling in a dependency for a lint-shaped check.
const workflows = ['ci.yml', 'build-test.yml'];

function testSteps(file) {
  const doc = yaml.load(fs.readFileSync(path.join('.github/workflows', file), 'utf8'));
  const steps = Object.values(doc.jobs).flatMap((job) => job.steps || []);
  return steps.filter((s) => /pass 1|pass 2/i.test(s.name || ''));
}

describe('CI test passes stay comparable', () => {
  for (const file of workflows) {
    it(`${file} has both passes`, () => {
      const steps = testSteps(file);
      expect(steps.map((s) => s.name).filter((n) => /pass 1/i.test(n))).toHaveLength(1);
      expect(steps.map((s) => s.name).filter((n) => /pass 2/i.test(n))).toHaveLength(1);
    });

    it(`${file} runs the same DB-gated set in both passes`, () => {
      const steps = testSteps(file);
      const pass1 = steps.find((s) => /pass 1/i.test(s.name));
      const pass2 = steps.find((s) => /pass 2/i.test(s.name));
      // DB8_TEST_PG is what unlocks the six DB-gated suites. Both passes must
      // agree, or pass 2 is measuring a different suite than pass 1.
      expect(String(pass1.env?.DB8_TEST_PG ?? '')).toBe(String(pass2.env?.DB8_TEST_PG ?? ''));
    });

    it(`${file} points both passes at the same database`, () => {
      const steps = testSteps(file);
      const pass1 = steps.find((s) => /pass 1/i.test(s.name));
      const pass2 = steps.find((s) => /pass 2/i.test(s.name));
      expect(pass1.env?.DATABASE_URL).toBe(pass2.env?.DATABASE_URL);
      expect(String(pass1.env?.DB8_TEST_DATABASE_URL ?? '')).toBe(
        String(pass2.env?.DB8_TEST_DATABASE_URL ?? '')
      );
    });
  }
});
