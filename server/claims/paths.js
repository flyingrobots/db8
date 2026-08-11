import { CHILD_KEYS, LIST_KEYS, isNode, formatPath } from './terms.js';

// Path addressing for claim terms.
//
// A path names one node inside a term. This is what lets a verification verdict
// say *which layer* it rules on: a verdict at `$` on an attribution node means
// "the source does not say that", while a verdict at `$.body` means "the source
// says it and it is false". Those are different findings, and db8's flat
// claim_id could not tell them apart.

// The structural primitives live in terms.js, which owns the node contract. A
// second copy here drifts from the path grammar the moment a child slot changes,
// and path resolution then starts returning undefined for legitimate nodes.
export { formatPath };

/** Parse `$.parts[1].body` back into `['parts', 1, 'body']`. */
export function parsePath(text) {
  if (typeof text !== 'string' || text.length === 0 || text[0] !== '$') return null;
  const steps = [];
  const re = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
  let consumed = 1;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index !== consumed) return null;
    consumed = match.index + match[0].length;
    steps.push(match[1] !== undefined ? match[1] : Number(match[2]));
  }
  return consumed === text.length ? steps : null;
}

/**
 * Resolve a path against a term.
 * Returns undefined when the path does not name a real node — traversal only
 * follows the child slots the node kind actually declares, so a wrong path
 * fails rather than silently landing on arbitrary data.
 *
 * `null` is rejected rather than coerced to the root: `parsePath` returns null
 * for malformed input, and treating that as "no steps" would let a bad verdict
 * path silently rule on the whole term instead of failing.
 *
 * Precondition: `term` must have passed `validateTerm`; this traversal enforces
 * neither MAX_DEPTH nor MAX_NODES.
 */
export function atPath(term, path) {
  if (path !== undefined && !Array.isArray(path)) return undefined;
  let node = term;
  const steps = path ?? [];
  for (let i = 0; i < steps.length; i += 1) {
    if (!isNode(node) || typeof node.kind !== 'string') return undefined;
    const key = steps[i];
    if (typeof key !== 'string') return undefined;
    if (!(CHILD_KEYS[node.kind] ?? []).includes(key)) return undefined;
    if (LIST_KEYS.has(key)) {
      const index = steps[i + 1];
      if (!Array.isArray(node[key]) || typeof index !== 'number') return undefined;
      node = node[key][index];
      i += 1;
    } else {
      node = node[key];
    }
    if (node === undefined) return undefined;
  }
  return node;
}

/** Every addressable node in the term, root first, in document order. */
export function pathsOf(term) {
  const out = [];
  const visit = (node, path) => {
    if (!isNode(node) || typeof node.kind !== 'string') return;
    out.push(path);
    for (const key of CHILD_KEYS[node.kind] ?? []) {
      const child = node[key];
      if (LIST_KEYS.has(key)) {
        if (!Array.isArray(child)) continue;
        child.forEach((item, i) => visit(item, [...path, key, i]));
      } else {
        visit(child, [...path, key]);
      }
    }
  };
  visit(term, []);
  return out;
}
