import { describe, it, expect } from 'vitest';
import { resolveCanonicalizer, normalizeCanonMode, CANON_MODES } from '../canon-mode.js';

// A canonicalization mode decides what gets hashed and signed. Every place that
// reads one must reject a value it does not recognize, because the alternative
// is silently signing under a different scheme than the operator asked for.
//
// The CLI had this bug — anything not exactly 'jcs' fell into the sorted branch.
// The watcher had the same shape: `process.env.CANON_MODE || 'jcs'`, passed
// straight to createSigner, so a typo signed journals as jcs while the operator
// believed they were sorted.

describe('canonicalization modes are validated wherever they are read', () => {
  it('accepts the declared modes', () => {
    for (const mode of CANON_MODES) {
      expect(normalizeCanonMode(mode)).toBe(mode);
    }
  });

  it('defaults an absent mode to jcs', () => {
    expect(normalizeCanonMode(undefined)).toBe('jcs');
    expect(normalizeCanonMode('')).toBe('jcs');
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeCanonMode('  SORTED ')).toBe('sorted');
  });

  it('rejects an unrecognized mode rather than falling back', () => {
    for (const bad of ['jsc', 'sorted_v2', 'canonical', 'true']) {
      expect(() => normalizeCanonMode(bad), bad).toThrow(/CANON_MODE/);
    }
  });

  it('names the variable it was told about, so the error is actionable', () => {
    expect(() => normalizeCanonMode('jsc', { varName: 'DB8_CANON_MODE' })).toThrow(
      /DB8_CANON_MODE/
    );
  });

  it('tags the error so callers can classify it without matching on text', () => {
    try {
      normalizeCanonMode('jsc');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('invalid_canon_mode');
    }
  });

  it('resolveCanonicalizer rejects the same values', () => {
    expect(() => resolveCanonicalizer('jsc')).toThrow(/CANON_MODE/);
  });
});
