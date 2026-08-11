import { z } from 'zod';
import { canonicalizeJCS, canonicalizeSorted, sha256Hex } from '../utils.js';

// Structured claims for db8 debates.
//
// A claim is a tree, not a sentence. Leaves are propositions; interior nodes are
// the context that decides how those propositions must be read. The rule the whole
// module exists to enforce is that context is never deletable: wrapping a
// proposition in "the study says" or "suppose that" must never let a downstream
// consumer read it as an assertion about the world. See docs/specs/ClaimTerms.md.

export const FRAME_KINDS = Object.freeze([
  'attribution',
  'belief',
  'hypothetical',
  'hedge',
  'evaluative',
  'temporal',
  'domain'
]);

// Transparent frames narrow a proposition without suspending it: "in the US,
// remote work reduces productivity" still asserts something checkable. Every
// other frame is opaque — it suspends assertion entirely.
export const TRANSPARENT_FRAMES = Object.freeze(['temporal', 'domain']);

export const MAX_DEPTH = 16;
export const MAX_NODES = 256;

// Child slots per node kind. Ordered, because order is meaning-bearing and the
// path grammar (paths.js) and the canonical form both depend on it.
export const CHILD_KEYS = Object.freeze({
  claim: [],
  framed: ['body'],
  all: ['parts'],
  either: ['options'],
  denial: ['body'],
  conditional: ['when', 'then'],
  concession: ['even_if', 'still']
});

export const LIST_KEYS = new Set(['parts', 'options']);

const EntityRef = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('named'),
      name: z.string().min(1),
      ref: z.string().min(1).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('anonymous'),
      localId: z.string().min(1),
      description: z.string().min(1).optional()
    })
    .strict()
]);

// JSON-shaped payloads with entity references as first-class leaves, so a
// traversal can find and relabel every reference generically. Numbers must be
// finite: NaN and +/-Infinity have no JSON form and would break canonical hashing.
const ClaimValue = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.object({ kind: z.literal('entity'), value: EntityRef }).strict(),
    z.array(ClaimValue),
    // z.union takes the first member that parses, so a malformed entity would
    // otherwise fall through to here and persist as a record wearing an entity
    // badge — breaking the promise above that a traversal can find every
    // reference generically.
    z.record(z.string(), ClaimValue).refine((o) => o.kind !== 'entity', {
      error: 'object with kind "entity" must be a valid entity reference'
    })
  ])
);

const Predicate = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, 'predicate must be snake_case');

const Frame = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('attribution'), source: EntityRef }).strict(),
  z.object({ kind: z.literal('belief'), holder: EntityRef }).strict(),
  z.object({ kind: z.literal('hypothetical'), premise: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('hedge'), expression: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('evaluative'), standard: z.string().min(1).optional() }).strict(),
  z
    .object({
      kind: z.literal('temporal'),
      at: z.string().min(1).optional(),
      expression: z.string().min(1).optional()
    })
    .strict(),
  z.object({ kind: z.literal('domain'), restriction: z.string().min(1) }).strict()
]);

let cachedTerm = null;
const Term = z.lazy(() => {
  if (!cachedTerm) {
    cachedTerm = z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('claim'),
          subject: EntityRef,
          predicate: Predicate,
          object: ClaimValue
        })
        .strict(),
      z.object({ kind: z.literal('framed'), frame: Frame, body: Term }).strict(),
      z.object({ kind: z.literal('all'), parts: z.array(Term).min(1) }).strict(),
      z
        .object({
          kind: z.literal('either'),
          options: z.array(Term).min(2, 'either requires at least two options')
        })
        .strict(),
      z.object({ kind: z.literal('denial'), body: Term }).strict(),
      z.object({ kind: z.literal('conditional'), when: Term, then: Term }).strict(),
      z.object({ kind: z.literal('concession'), even_if: Term, still: Term }).strict()
    ]);
  }
  return cachedTerm;
});

export const ClaimTerm = Term;

export function isNode(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `__proto__` is a legal JSON key that JavaScript cannot carry as ordinary data:
// Zod's record parser drops it, so a payload containing it would validate and
// come back mutated. Terms are stored as authored and content-addressed, so
// silently losing part of a payload is the one outcome that cannot stand — the
// author gets an error instead.
const FORBIDDEN_PAYLOAD_KEYS = Object.freeze(['__proto__']);

function findForbiddenKeys(value, found) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) findForbiddenKeys(item, found);
    return;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.includes(key)) found.add(key);
    findForbiddenKeys(value[key], found);
  }
}

// A claim payload is arbitrary JSON and can nest without bound. Zod and the
// canonicalizer both recurse through it, so it has to count against the same
// limits as the term itself — otherwise a deep enough payload raises a
// RangeError from inside a function documented to return a validation result.
function measurePayload(value, depth, state) {
  if (depth > state.maxDepth) state.maxDepth = depth;
  if (value === null || typeof value !== 'object') return;
  if (state.count > MAX_NODES || state.maxDepth > MAX_DEPTH) return;
  state.count += 1;
  if (Array.isArray(value)) {
    for (const item of value) measurePayload(item, depth + 1, state);
    return;
  }
  for (const key of Object.keys(value)) measurePayload(value[key], depth + 1, state);
}

// Depth and size are checked before Zod so an over-nested term reports the real
// cause rather than a wall of union failures.
function measure(node, depth, state, path) {
  if (!isNode(node) || typeof node.kind !== 'string') return;
  state.count += 1;
  if (depth > state.maxDepth) {
    state.maxDepth = depth;
    state.deepestPath = path;
  }
  if (state.count > MAX_NODES) return;
  if (node.kind === 'claim') {
    const before = state.maxDepth;
    measurePayload(node.object, depth, state);
    if (state.maxDepth > before) state.deepestPath = path;
    return;
  }
  for (const key of CHILD_KEYS[node.kind] ?? []) {
    const child = node[key];
    if (LIST_KEYS.has(key)) {
      if (!Array.isArray(child)) continue;
      child.forEach((item, i) => measure(item, depth + 1, state, [...path, key, i]));
    } else {
      measure(child, depth + 1, state, [...path, key]);
    }
  }
}

// One traversal, driven by CHILD_KEYS. Every structural walk in this module is a
// filter over it — a second copy of the descent logic drifts from the path
// grammar the moment a child slot is added.
function walkNodes(node, path, visit) {
  if (!isNode(node) || typeof node.kind !== 'string') return;
  visit(node, path);
  for (const key of CHILD_KEYS[node.kind] ?? []) {
    const child = node[key];
    if (LIST_KEYS.has(key)) {
      if (!Array.isArray(child)) continue;
      child.forEach((item, i) => walkNodes(item, [...path, key, i], visit));
    } else {
      walkNodes(child, [...path, key], visit);
    }
  }
}

function walkClaims(term, path, visit) {
  walkNodes(term, path, (node, at) => {
    if (node.kind === 'claim') visit(node, at);
  });
}

function walkFrames(term, path, visit) {
  walkNodes(term, path, (node, at) => {
    // The frame is reported at the node that owns it, not at `$…frame`: `frame`
    // is not a declared child slot, so a path through it is one atPath cannot
    // resolve and pathsOf never enumerates — and every path db8 hands out must
    // be one a verdict can be filed against.
    if (node.kind === 'framed' && isNode(node.frame)) visit(node.frame, at);
  });
}

function walkEither(term, path, visit) {
  walkNodes(term, path, (node, at) => {
    if (node.kind === 'either' && Array.isArray(node.options)) visit(node.options, at);
  });
}

/** Render a path as a stable string, e.g. `$.parts[1].body`. */
export function formatPath(path) {
  let out = '$';
  for (const step of path ?? []) out += typeof step === 'number' ? `[${step}]` : `.${step}`;
  return out;
}

/**
 * Validate a claim term.
 *
 * @param {unknown} term          the candidate term
 * @param {object}  [opts]
 * @param {string[]} [opts.predicates] declared predicate vocabulary; when supplied,
 *   any predicate outside it is rejected. Room-level vocabularies are what make
 *   claims comparable across debates — without one, every author invents their own.
 * @returns {{ok: boolean, errors: Array<{path: string, message: string}>, value?: object}}
 */
export function validateTerm(term, opts = {}) {
  const errors = [];
  if (!isNode(term) || typeof term.kind !== 'string') {
    return { ok: false, errors: [{ path: '$', message: 'term must be an object with a kind' }] };
  }

  const state = { count: 0, maxDepth: 0, deepestPath: [] };
  measure(term, 0, state, []);
  // Inclusive, matching the node-count cap below: reaching the limit is legal,
  // exceeding it is not, and the message says "exceeds".
  if (state.maxDepth > MAX_DEPTH) {
    errors.push({
      path: formatPath(state.deepestPath),
      message: `term exceeds maximum nesting depth of ${MAX_DEPTH}`
    });
  }
  if (state.count > MAX_NODES) {
    errors.push({ path: '$', message: `term exceeds maximum size of ${MAX_NODES} nodes` });
  }
  if (errors.length > 0) return { ok: false, errors };

  const parsed = Term.safeParse(term);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ path: formatPath(issue.path), message: issue.message });
    }
    return { ok: false, errors };
  }

  // A temporal frame that anchors nothing is a no-op wrapper; reject it rather
  // than letting it masquerade as context.
  walkFrames(term, [], (frame, path) => {
    if (frame.kind === 'temporal' && frame.at === undefined && frame.expression === undefined) {
      errors.push({
        path: formatPath(path),
        message: 'temporal frame requires at or expression'
      });
    }
  });

  walkClaims(term, [], (claim, path) => {
    const found = new Set();
    findForbiddenKeys(claim.object, found);
    for (const key of found) {
      errors.push({
        path: formatPath(path),
        message: `claim payload may not use the reserved key "${key}"`
      });
    }
  });

  // An either whose options are not distinct is not an unresolved choice.
  // Projection stops at every either, so `either([P, P])` would otherwise let an
  // author assert P while presenting it as a choice nobody has to rule on.
  // Compared under JCS regardless of CANON_MODE: whether two options are the
  // same term is a fact about the term, not about how the node serializes it.
  walkEither(term, [], (options, path) => {
    const distinct = new Set(options.map((option) => canonicalizeJCS(option)));
    if (distinct.size < 2) {
      errors.push({
        path: formatPath(path),
        message: 'either requires at least two distinct options'
      });
    }
  });

  const vocabulary = Array.isArray(opts.predicates) ? new Set(opts.predicates) : null;
  if (vocabulary) {
    walkClaims(term, [], (claim, path) => {
      if (!vocabulary.has(claim.predicate)) {
        errors.push({
          path: formatPath(path),
          message: `predicate "${claim.predicate}" is not in the room's declared vocabulary`
        });
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value: parsed.data };
}

// Claim terms are signing-adjacent, so they canonicalize through the same
// validated CANON_MODE the rest of the server uses (server/canonicalizer.js,
// via config-builder). DB8_CANON_MODE is deliberately NOT read here: it is a
// CLI alias, and letting it win would move signed material off the documented
// server path.
//
// The validation is duplicated from config-builder rather than imported because
// server/canonicalizer.js calls loadConfig() at module scope, and this module is
// reached from bin/db8.js through server/schemas.js — importing it would load
// server configuration into the CLI.
function canonicalizer() {
  const raw = process.env.CANON_MODE ?? 'jcs';
  const mode = String(raw).toLowerCase().trim() || 'jcs';
  if (mode === 'sorted') return canonicalizeSorted;
  if (mode === 'jcs') return canonicalizeJCS;
  throw new Error(`Invalid CANON_MODE: '${raw}'. Allowed: sorted|jcs`);
}

/** Canonical serialization of a term. Key order is normalized; child order is not. */
export function canonicalTerm(term) {
  return canonicalizer()(term);
}

/**
 * Content address of a term, for signing and for binding verdicts to what was
 * claimed. Validates first: an unvalidated term can carry payloads with no JSON
 * form (`Infinity` serializes as `null`), so two distinct terms would share one
 * address, and a content address that collides is not a content address.
 *
 * @throws {Error} when the term does not validate
 */
export function termHash(term) {
  const result = validateTerm(term);
  if (!result.ok) {
    throw new Error(
      `cannot hash an invalid term: ${result.errors[0].path} ${result.errors[0].message}`
    );
  }
  return sha256Hex(canonicalTerm(result.value));
}

/** Collect every predicate used, so a room can seed or audit its vocabulary. */
export function predicatesOf(term) {
  const found = new Set();
  walkClaims(term, [], (claim) => found.add(claim.predicate));
  return [...found].sort();
}
