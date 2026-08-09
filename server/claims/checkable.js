import { TRANSPARENT_FRAMES } from './terms.js';

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
//   - every part of an `all`, since a conjunction asserts each part
//   - the body of a `denial`, with polarity flipped
//   - the `still` branch of a `concession` — "even if X, Y still holds" asserts Y
//
// It stops at:
//   - any opaque frame (attribution, belief, hypothetical, hedge, evaluative)
//   - `either`, since a disjunction asserts no particular option
//   - both branches of a `conditional`, since neither is claimed outright
//   - the `even_if` branch of a `concession`, which is granted, not claimed

/**
 * @typedef {object} CheckableClaim
 * @property {object} claim     the atomic proposition node
 * @property {Array<string|number>} path  where it sits in the term
 * @property {'affirm'|'deny'} polarity   whether the author affirmed or denied it
 * @property {object[]} context           transparent frames above it, outermost first
 */

/**
 * @param {object} term
 * @returns {CheckableClaim[]}
 */
export function checkableClaims(term) {
  const out = [];

  const visit = (node, path, polarity, context) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;

    switch (node.kind) {
      case 'claim':
        out.push({ claim: node, path, polarity, context });
        return;

      case 'framed': {
        const kind = node.frame?.kind;
        if (!TRANSPARENT_FRAMES.includes(kind)) return; // opaque: assertion suspended
        visit(node.body, [...path, 'body'], polarity, [...context, node.frame]);
        return;
      }

      case 'all':
        if (!Array.isArray(node.parts)) return;
        node.parts.forEach((part, i) => visit(part, [...path, 'parts', i], polarity, context));
        return;

      case 'denial':
        visit(node.body, [...path, 'body'], polarity === 'affirm' ? 'deny' : 'affirm', context);
        return;

      case 'concession':
        visit(node.still, [...path, 'still'], polarity, context);
        return;

      case 'either':
      case 'conditional':
      default:
        return;
    }
  };

  visit(term, [], 'affirm', []);
  return out;
}

/**
 * True when the term asserts nothing checkable — every proposition in it sits
 * behind an opaque frame, a disjunction, or a condition. Useful for telling an
 * author that a submission made no falsifiable claim at all.
 */
export function assertsNothing(term) {
  return checkableClaims(term).length === 0;
}
