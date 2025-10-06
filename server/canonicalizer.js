import { loadConfig } from './config/config-builder.js';
import { canonicalizeSorted, canonicalizeJCS } from './utils.js';

export function selectCanonicalizer(mode) {
  const canon = String(mode || 'jcs').toLowerCase();
  return canon === 'jcs' ? canonicalizeJCS : canonicalizeSorted;
}

const config = loadConfig();
const canonicalizer = selectCanonicalizer(config.canonMode);

export default canonicalizer;
