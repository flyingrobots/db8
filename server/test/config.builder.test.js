import { describe, it, expect } from 'vitest';
import { ConfigBuilder } from '../config/config-builder.js';

class StubSecrets {
  constructor(map) {
    this.map = map || {};
  }
  get(name) {
    return this.map[name];
  }
}

describe('ConfigBuilder', () => {
  it('uses defaults when values are absent', () => {
    const cfg = new ConfigBuilder(new StubSecrets()).build();
    expect(cfg.port).toBe(3000);
    expect(cfg.enforceRateLimit).toBe(false);
    expect(cfg.databaseUrl).toBe('');
  });

  it('parses values from secret source', () => {
    const secrets = new StubSecrets({
      PORT: '4000',
      ENFORCE_RATELIMIT: '1',
      DATABASE_URL: 'postgres://x',
      SUBMIT_WINDOW_SEC: '123',
      CONTINUE_WINDOW_SEC: '9'
    });
    const cfg = new ConfigBuilder(secrets).build();
    expect(cfg.port).toBe(4000);
    expect(cfg.enforceRateLimit).toBe(true);
    expect(cfg.databaseUrl).toBe('postgres://x');
    expect(cfg.submitWindowSec).toBe(123);
    expect(cfg.continueWindowSec).toBe(9);
  });
});
