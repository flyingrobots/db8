import { EnvSecretSource } from './secret-source.js';

export class ConfigBuilder {
  constructor(secretSource = new EnvSecretSource()) {
    this.s = secretSource;
    this._overrides = {};
  }

  with(key, val) {
    this._overrides[key] = val;
    return this;
  }

  // Helpers to parse from secrets/env
  _str(name, def) {
    if (name in this._overrides) return String(this._overrides[name] ?? '');
    const v = this.s.get(name);
    return v === undefined ? def : String(v);
  }
  _bool(name, def) {
    if (name in this._overrides) return Boolean(this._overrides[name]);
    const v = this.s.get(name);
    if (v === undefined) return def;
    return v === '1' || v === 'true' || v === 'TRUE';
  }
  _int(name, def) {
    if (name in this._overrides) return Number(this._overrides[name]) | 0;
    const v = this.s.get(name);
    if (v === undefined) return def;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : def;
  }

  build() {
    const cfg = {
      nodeEnv: this._str('NODE_ENV', 'development'),
      port: this._int('PORT', 3000),
      databaseUrl: this._str('DATABASE_URL', ''),
      enforceRateLimit: this._bool('ENFORCE_RATELIMIT', false),
      submitWindowSec: this._int('SUBMIT_WINDOW_SEC', 300),
      continueWindowSec: this._int('CONTINUE_WINDOW_SEC', 30)
    };
    return Object.freeze(cfg);
  }
}

export function loadConfig(secretSource) {
  return new ConfigBuilder(secretSource).build();
}
