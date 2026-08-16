import { canonicalizeSorted, canonicalizeJCS } from './utils.js';

// One place that turns a canonicalization mode into a canonicalizer.
//
// There were three: server/claims/terms.js validated the mode itself,
// server/canonicalizer.js selected leniently, and bin/db8.js carried its own
// implementation whose `sorted` branch was
//
//   JSON.stringify(value, Object.keys(value).sort())
//
// A replacer *array* is an allow-list applied at every depth, not a key
// ordering — so nested keys were deleted. Every claim and citation in a real
// submission collapsed to `{}`, two different arguments produced one digest, and
// anything signed under `sorted` failed server-side verification.
//
// This module holds no configuration and reads no environment, so the CLI can
// import it without dragging server config into the CLI process. Each caller
// decides which variable to read; this decides what the value means.

export const CANON_MODES = Object.freeze(['sorted', 'jcs']);

/**
 * @param {unknown} raw the configured mode
 * @param {object} [opts]
 * @param {string} [opts.varName] variable named in the error, for a useful message
 * @returns {(value: unknown) => string}
 * @throws {Error} when the mode is not one of CANON_MODES — a typo must not
 *   silently select a different canonicalizer, because what gets signed depends
 *   on it.
 */
export function resolveCanonicalizer(raw, { varName = 'CANON_MODE' } = {}) {
  const mode = String(raw ?? 'jcs')
    .toLowerCase()
    .trim();
  if (mode === '' || mode === 'jcs') return canonicalizeJCS;
  if (mode === 'sorted') return canonicalizeSorted;
  const err = new Error(`Invalid ${varName}: '${raw}'. Allowed: ${CANON_MODES.join('|')}`);
  // Tagged so a caller can tell permanent misconfiguration from a transient
  // fault, rather than matching on the message.
  err.code = 'invalid_canon_mode';
  throw err;
}
