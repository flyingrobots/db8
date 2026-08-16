import { describe, it, expect } from 'vitest';
import { RoomCreate, RoomConfig } from '../schemas.js';

// The schema is the other half of "room configuration is unreachable".
//
// Fixing `room_create` to persist `p_cfg` is not enough on its own: Zod strips
// undeclared properties, so a key this schema does not name can never reach the
// RPC over HTTP however correct the SQL is. `cfg` previously declared only
// participant_count and submit_minutes, which is why attribution_mode,
// max_fetches_per_round, and predicates had no route in.

const base = { topic: 'A topic long enough', client_nonce: 'nonce-12345678' };

describe('room configuration survives the schema boundary', () => {
  it('carries every key that has a reader elsewhere in the system', () => {
    const cfg = {
      participant_count: 4,
      submit_minutes: 5,
      attribution_mode: 'masked',
      max_fetches_per_round: 10,
      predicates: ['reduces', 'increases'],
      tags: ['science']
    };
    const parsed = RoomCreate.parse({ ...base, cfg });
    // Equality, not a subset match: a stripped key is exactly the failure mode.
    expect(parsed.cfg).toEqual(cfg);
  });

  it('rejects a key nothing reads rather than silently dropping it', () => {
    // .strict() so a typo is an error a caller can see, not a setting that
    // vanishes and appears not to have worked.
    expect(() => RoomConfig.parse({ atribution_mode: 'masked' })).toThrow();
  });

  it('accepts only the two attribution modes the view understands', () => {
    expect(RoomConfig.parse({ attribution_mode: 'open' }).attribution_mode).toBe('open');
    expect(RoomConfig.parse({ attribution_mode: 'masked' }).attribution_mode).toBe('masked');
    expect(() => RoomConfig.parse({ attribution_mode: 'anonymous' })).toThrow();
  });

  it('requires a declared vocabulary to use the predicate shape claims use', () => {
    // A room could otherwise declare a vocabulary containing predicates that no
    // claim is allowed to contain, which validateTerm would reject on every use.
    expect(RoomConfig.parse({ predicates: ['reduces'] }).predicates).toEqual(['reduces']);
    expect(() => RoomConfig.parse({ predicates: ['Reduces'] })).toThrow();
    expect(() => RoomConfig.parse({ predicates: ['has space'] })).toThrow();
    expect(
      () => RoomConfig.parse({ predicates: [] }),
      'an empty vocabulary bans every claim'
    ).toThrow();
  });

  it('keeps the existing bounds on participant_count and submit_minutes', () => {
    expect(() => RoomConfig.parse({ participant_count: 0 })).toThrow();
    expect(() => RoomConfig.parse({ participant_count: 65 })).toThrow();
    expect(() => RoomConfig.parse({ submit_minutes: 0 })).toThrow();
    expect(() => RoomConfig.parse({ submit_minutes: 1441 })).toThrow();
  });

  it('still accepts a room created with no configuration at all', () => {
    expect(RoomCreate.parse(base).cfg).toBeUndefined();
  });
});
