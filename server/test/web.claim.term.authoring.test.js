import { describe, it, expect } from 'vitest';
import { SubmissionIn } from '../schemas.js';
import {
  NODE_KINDS,
  FRAME_KINDS,
  emptyNode,
  emptyFrame,
  pruneTerm,
  describeProblems
} from '../../web/lib/claimTerm.js';
import { FRAME_KINDS as SERVER_FRAME_KINDS, CHILD_KEYS } from '../claims/terms.js';

// The browser editor builds the shape the server validates. These run the
// editor's own helpers against the real SubmissionIn schema, because the
// failure this guards against is precisely the two drifting apart — the web
// client sent `claim.text` for the whole of the cutover and nothing noticed.

const envelope = (term) => ({
  room_id: '00000000-0000-4000-8000-000000000000',
  round_id: '00000000-0000-4000-8000-000000000001',
  author_id: '00000000-0000-4000-8000-000000000002',
  phase: 'submit',
  deadline_unix: 1893456000,
  content: 'body text',
  claims: [{ id: 'c1', term, support: [{ kind: 'logic', ref: 'analysis' }] }],
  citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
  client_nonce: 'nonce-web-authoring'
});

// Fills every empty slot the editor starts a node with, so the result is a term
// a user could actually have completed.
function complete(node, seed = 'a') {
  switch (node.kind) {
    case 'claim':
      return {
        kind: 'claim',
        subject: { kind: 'named', name: `subject_${seed}` },
        predicate: `predicate_${seed}`,
        object: `object_${seed}`
      };
    case 'framed': {
      const spec = {
        attribution: { source: { kind: 'named', name: 'the_study' } },
        belief: { holder: { kind: 'named', name: 'opponent' } },
        hypothetical: {},
        hedge: { expression: 'possibly' },
        evaluative: {},
        temporal: { expression: 'in 2024' },
        domain: { restriction: 'united_states' }
      }[node.frame.kind];
      return {
        kind: 'framed',
        frame: { kind: node.frame.kind, ...spec },
        body: complete(node.body, seed)
      };
    }
    case 'all':
      return { kind: 'all', parts: node.parts.map((p, i) => complete(p, `${seed}${i}`)) };
    case 'either':
      return { kind: 'either', options: node.options.map((o, i) => complete(o, `${seed}${i}`)) };
    case 'denial':
      return { kind: 'denial', body: complete(node.body, seed) };
    case 'conditional':
      return {
        kind: 'conditional',
        when: complete(node.when, `${seed}w`),
        then: complete(node.then, `${seed}t`)
      };
    case 'concession':
      return {
        kind: 'concession',
        even_if: complete(node.even_if, `${seed}e`),
        still: complete(node.still, `${seed}s`)
      };
    default:
      return node;
  }
}

describe('the browser editor and the server schema agree', () => {
  it('offers exactly the node kinds the server declares', () => {
    expect([...NODE_KINDS].sort()).toEqual(Object.keys(CHILD_KEYS).sort());
  });

  it('offers exactly the frame kinds the server declares', () => {
    expect([...FRAME_KINDS].sort()).toEqual([...SERVER_FRAME_KINDS].sort());
  });

  it('produces a submittable term for every node kind', () => {
    for (const kind of NODE_KINDS) {
      const term = pruneTerm(complete(emptyNode(kind)));
      const result = SubmissionIn.safeParse(envelope(term));
      expect(result.success, `${kind}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('produces a submittable term for every frame kind', () => {
    for (const frameKind of FRAME_KINDS) {
      const node = { ...emptyNode('framed'), frame: emptyFrame(frameKind) };
      const term = pruneTerm(complete(node));
      const result = SubmissionIn.safeParse(envelope(term));
      expect(result.success, `${frameKind}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  // The server's frame schemas are strict, so an optional field left blank has
  // to be absent rather than an empty string.
  it('drops blank optional frame fields instead of sending empty strings', () => {
    const node = { ...emptyNode('framed'), frame: emptyFrame('hypothetical') };
    const pruned = pruneTerm(complete(node));
    expect(pruned.frame).toEqual({ kind: 'hypothetical' });
    expect(SubmissionIn.safeParse(envelope(pruned)).success).toBe(true);
  });
});

describe('the editor reports its own incomplete slots', () => {
  it('flags a freshly created node of every kind', () => {
    for (const kind of NODE_KINDS) {
      expect(describeProblems(emptyNode(kind)).length, kind).toBeGreaterThan(0);
    }
  });

  it('reports nothing once every slot is filled', () => {
    for (const kind of NODE_KINDS) {
      expect(describeProblems(complete(emptyNode(kind))), kind).toEqual([]);
    }
  });

  it('names the offending path', () => {
    const node = complete(emptyNode('conditional'));
    node.then.predicate = '';
    expect(describeProblems(node)).toContain('$.then: predicate is empty');
  });

  it('rejects a non-snake_case predicate the way the server would', () => {
    const node = complete(emptyNode('claim'));
    node.predicate = 'Reduces Productivity';
    expect(describeProblems(node)[0]).toMatch(/snake_case/);
    expect(SubmissionIn.safeParse(envelope(node)).success).toBe(false);
  });

  // Projection stops at every either, so identical options would let an author
  // assert something while presenting it as an open choice.
  it('flags an either whose options are identical', () => {
    const node = complete(emptyNode('either'));
    node.options[1] = node.options[0];
    expect(describeProblems(node)).toContain('$: options must be different');
    expect(SubmissionIn.safeParse(envelope(node)).success).toBe(false);
  });
});
