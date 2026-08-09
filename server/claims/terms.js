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

const LIST_KEYS = new Set(['parts', 'options']);

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
    z.record(ClaimValue)
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

function isNode(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function walkClaims(node, path, visit) {
  if (!isNode(node) || typeof node.kind !== 'string') return;
  if (node.kind === 'claim') {
    visit(node, path);
    return;
  }
  for (const key of CHILD_KEYS[node.kind] ?? []) {
    const child = node[key];
    if (LIST_KEYS.has(key)) {
      if (!Array.isArray(child)) continue;
      child.forEach((item, i) => walkClaims(item, [...path, key, i], visit));
    } else {
      walkClaims(child, [...path, key], visit);
    }
  }
}

function walkFrames(node, path, visit) {
  if (!isNode(node) || typeof node.kind !== 'string') return;
  if (node.kind === 'framed' && isNode(node.frame)) visit(node.frame, [...path, 'frame']);
  for (const key of CHILD_KEYS[node.kind] ?? []) {
    const child = node[key];
    if (LIST_KEYS.has(key)) {
      if (!Array.isArray(child)) continue;
      child.forEach((item, i) => walkFrames(item, [...path, key, i], visit));
    } else {
      walkFrames(child, [...path, key], visit);
    }
  }
}

function pathString(path) {
  let out = '$';
  for (const step of path) out += typeof step === 'number' ? `[${step}]` : `.${step}`;
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
  if (state.maxDepth >= MAX_DEPTH) {
    errors.push({
      path: pathString(state.deepestPath),
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
      errors.push({ path: pathString(issue.path), message: issue.message });
    }
    return { ok: false, errors };
  }

  // A temporal frame that anchors nothing is a no-op wrapper; reject it rather
  // than letting it masquerade as context.
  walkFrames(term, [], (frame, path) => {
    if (frame.kind === 'temporal' && frame.at === undefined && frame.expression === undefined) {
      errors.push({
        path: pathString(path),
        message: 'temporal frame requires at or expression'
      });
    }
  });

  const vocabulary = Array.isArray(opts.predicates) ? new Set(opts.predicates) : null;
  if (vocabulary) {
    walkClaims(term, [], (claim, path) => {
      if (!vocabulary.has(claim.predicate)) {
        errors.push({
          path: pathString(path),
          message: `predicate "${claim.predicate}" is not in the room's declared vocabulary`
        });
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value: parsed.data };
}

function canonicalizer() {
  const mode = String(process.env.DB8_CANON_MODE || process.env.CANON_MODE || 'jcs').toLowerCase();
  return mode === 'sorted' ? canonicalizeSorted : canonicalizeJCS;
}

/** Canonical serialization of a term. Key order is normalized; child order is not. */
export function canonicalTerm(term) {
  return canonicalizer()(term);
}

/** Content address of a term, for signing and for binding verdicts to what was claimed. */
export function termHash(term) {
  return sha256Hex(canonicalTerm(term));
}

/** Collect every predicate used, so a room can seed or audit its vocabulary. */
export function predicatesOf(term) {
  const found = new Set();
  walkClaims(term, [], (claim) => found.add(claim.predicate));
  return [...found].sort();
}
