import { describe, it, expect } from 'vitest';

function canonical(o) {
  return JSON.stringify(o, Object.keys(o).sort());
}

describe('canonical JSON hashing', () => {
  it('is stable regardless of key order', () => {
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    expect(canonical(a)).toEqual(canonical(b));
  });
});

