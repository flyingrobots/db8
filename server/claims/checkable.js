import { TRANSPARENT_FRAMES, isNode } from './terms.js';

// The non-factivity projection.
//
// Given a term, return only the propositions the author actually asserted about
// the world — the ones a fact-checker may rule on. Everything else stays behind
// its context. This is the operational form of the rule that framing is never
// deletable, and it is deliberately the *only* way the rest of db8 is allowed to
// turn a claim tree into checkable propositions.
//
// The traversal descends through:
//   - transparent frames (temporal, domain), accumulating them as context
//   - every part of an affirmed `all`, since a conjunction asserts each part
//   - the body of a `denial`, with polarity flipped
//   - the `still` branch of a `concession` — "even if X, Y still holds" asserts Y
//
// It stops at:
//   - any opaque frame (attribution, belief, hypothetical, hedge, evaluative)
//   - `either`, since a disjunction asserts no particular option
//   - a *denied* `all`: "not (A and B)" entails only that at least one conjunct
//     fails, so denying each part would attribute two claims to an author who
//     made neither
//   - a *denied* `concession`: denying "even if X, Y still holds" rejects the
//     concessive relation, not Y — X may defeat Y after all
//   - both branches of a `conditional`, since neither is claimed outright
//   - the `even_if` branch of a `concession`, which is granted, not claimed

/**
 * @typedef {object} CheckableClaim
 * @property {object} claim     the atomic proposition node
 * @property {Array<string|number>} path  where it sits in the term
 * @property {'affirm'|'deny'} polarity   whether the author affirmed or denied it
 * @property {object[]} context           transparent frames above it, outermost first
 */

// Frames that suspend the proposition but assert a relation of their own. "The
// study says P" does not claim P, yet whether the study said it is checkable —
// and that outer node is exactly what a claim path is for. A hypothetical or a
// hedge attributes the proposition to no one, so nothing is left to check.
const RELATIONAL_FRAMES = Object.freeze(['attribution', 'belief']);

/**
 * Precondition: `term` must have passed `validateTerm`. This traversal enforces
 * neither MAX_DEPTH nor MAX_NODES and will overflow the stack on unbounded input.
 *
 * @param {object} term
 * @returns {CheckableClaim[]}
 */
/**
 * Precondition: `term` must have passed `validateTerm`. This traversal enforces
 * neither MAX_DEPTH nor MAX_NODES and will overflow the stack on unbounded input.
 *
 * @param {object} term
 * @returns {CheckableClaim[]}
 */
export function checkableClaims(term) {
  const out = [];
  project(term, (claim, path, polarity, context) => out.push({ claim, path, polarity, context }));
  return out;
}

// One descent, so the two exported questions cannot disagree about what is in
// asserted position. `onClaim` fires for propositions a checker may rule on;
// `onRelation` fires for a frame whose own relation is asserted even though its
// body is suspended.
function project(term, onClaim, onRelation = () => {}) {
  const visit = (node, path, polarity, context) => {
    if (!isNode(node)) return;

    switch (node.kind) {
      case 'claim':
        onClaim(node, path, polarity, context);
        return;

      case 'framed': {
        const kind = node.frame?.kind;
        if (TRANSPARENT_FRAMES.includes(kind)) {
          visit(node.body, [...path, 'body'], polarity, [...context, node.frame]);
          return;
        }
        // Opaque: the body is suspended. The frame's own relation may still be
        // asserted, but only because we reached it in asserted position.
        if (RELATIONAL_FRAMES.includes(kind)) onRelation(node, path);
        return;
      }

      case 'all':
        // Affirmed only. "not (A and B)" entails just that one conjunct fails,
        // so denying each part would attribute two claims to an author who made
        // neither.
        if (!Array.isArray(node.parts) || polarity !== 'affirm') return;
        node.parts.forEach((part, i) => visit(part, [...path, 'parts', i], polarity, context));
        return;

      case 'denial':
        visit(node.body, [...path, 'body'], polarity === 'affirm' ? 'deny' : 'affirm', context);
        return;

      case 'concession':
        // Affirmed only, for the same reason as `all`: denying "even if X, Y
        // still holds" rejects the concessive relation, not Y itself.
        if (polarity !== 'affirm') return;
        visit(node.still, [...path, 'still'], polarity, context);
        return;

      case 'either':
      case 'conditional':
      default:
        return;
    }
  };

  visit(term, [], 'affirm', []);
}

/**
 * True when the term makes no falsifiable claim of any kind — useful for telling
 * an author their submission asserted nothing.
 *
 * Deliberately broader than `checkableClaims`, which answers a narrower
 * question: which atomic propositions may a fact-checker rule on. An attribution
 * yields no checkable proposition yet is not empty, so the two disagree on that
 * case by design.
 *
 * It shares one descent with `checkableClaims`, so an opaque ancestor suspends a
 * relational frame the same way it suspends a proposition: "suppose the study
 * says P" asserts neither P nor that the study said it.
 *
 * Precondition: `term` must have passed `validateTerm`.
 */
export function assertsNothing(term) {
  let asserts = false;
  const mark = () => {
    asserts = true;
  };
  project(term, mark, mark);
  return !asserts;
}
