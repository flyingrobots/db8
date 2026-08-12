// Shapes and helpers for authoring a claim term in the browser.
//
// The server is the authority: server/claims/terms.js validates every
// submission and will reject anything malformed. This module exists so the
// editor can offer the right slots for each node kind and so a half-built tree
// can be reported before the user submits it, rather than as a wall of schema
// errors afterwards.
//
// Kept deliberately small and framework-free: the node kinds and their child
// slots mirror CHILD_KEYS in server/claims/terms.js, and they must stay in step.

export const NODE_KINDS = [
  'claim',
  'framed',
  'all',
  'either',
  'denial',
  'conditional',
  'concession'
];

export const NODE_LABELS = {
  claim: 'Proposition',
  framed: 'Framed',
  all: 'All of',
  either: 'Either',
  denial: 'Not',
  conditional: 'If / then',
  concession: 'Even if / still'
};

export const NODE_HINTS = {
  claim: 'A single assertion: subject, predicate, object.',
  framed: 'Wraps a claim in context. Opaque frames suspend the assertion entirely.',
  all: 'A conjunction. Every part is asserted.',
  either: 'A disjunction. No particular option is asserted.',
  denial: 'Negates what it wraps.',
  conditional: 'Neither branch is asserted outright.',
  concession: 'Grants the premise and asserts the consequent.'
};

export const FRAME_KINDS = [
  'attribution',
  'belief',
  'hypothetical',
  'hedge',
  'evaluative',
  'temporal',
  'domain'
];

// Frames that narrow a proposition without suspending it.
export const TRANSPARENT_FRAMES = ['temporal', 'domain'];

// Which extra field each frame needs, and whether it is required. Mirrors the
// Frame union in server/claims/terms.js.
export const FRAME_FIELDS = {
  attribution: { field: 'source', label: 'Source', entity: true, required: true },
  belief: { field: 'holder', label: 'Holder', entity: true, required: true },
  hypothetical: { field: 'premise', label: 'Premise (optional)', required: false },
  hedge: { field: 'expression', label: 'Expression', required: true },
  evaluative: { field: 'standard', label: 'Standard (optional)', required: false },
  temporal: { field: 'expression', label: 'When', required: true },
  domain: { field: 'restriction', label: 'Restriction', required: true }
};

export function emptyNode(kind) {
  switch (kind) {
    case 'claim':
      return { kind: 'claim', subject: { kind: 'named', name: '' }, predicate: '', object: '' };
    case 'framed':
      return {
        kind: 'framed',
        frame: { kind: 'attribution', source: { kind: 'named', name: '' } },
        body: emptyNode('claim')
      };
    case 'all':
      return { kind: 'all', parts: [emptyNode('claim')] };
    case 'either':
      return { kind: 'either', options: [emptyNode('claim'), emptyNode('claim')] };
    case 'denial':
      return { kind: 'denial', body: emptyNode('claim') };
    case 'conditional':
      return { kind: 'conditional', when: emptyNode('claim'), then: emptyNode('claim') };
    case 'concession':
      return { kind: 'concession', even_if: emptyNode('claim'), still: emptyNode('claim') };
    default:
      return emptyNode('claim');
  }
}

export function emptyFrame(kind) {
  const spec = FRAME_FIELDS[kind];
  if (!spec) return { kind };
  if (spec.entity) return { kind, [spec.field]: { kind: 'named', name: '' } };
  return { kind, [spec.field]: '' };
}

// Strips the optional frame fields the user left blank, because the server's
// frame schemas are strict and an empty string is not the same as absent.
export function pruneTerm(node) {
  if (!node || typeof node !== 'object') return node;
  switch (node.kind) {
    case 'claim':
      return node;
    case 'framed': {
      const spec = FRAME_FIELDS[node.frame?.kind];
      const frame = { kind: node.frame?.kind };
      if (spec) {
        const value = node.frame?.[spec.field];
        const blank = spec.entity ? !value?.name : !String(value ?? '').trim();
        if (!blank) frame[spec.field] = value;
      }
      return { kind: 'framed', frame, body: pruneTerm(node.body) };
    }
    case 'all':
      return { kind: 'all', parts: (node.parts ?? []).map(pruneTerm) };
    case 'either':
      return { kind: 'either', options: (node.options ?? []).map(pruneTerm) };
    case 'denial':
      return { kind: 'denial', body: pruneTerm(node.body) };
    case 'conditional':
      return { kind: 'conditional', when: pruneTerm(node.when), then: pruneTerm(node.then) };
    case 'concession':
      return {
        kind: 'concession',
        even_if: pruneTerm(node.even_if),
        still: pruneTerm(node.still)
      };
    default:
      return node;
  }
}

/**
 * Local problems, reported while editing. Not a substitute for server
 * validation — it catches the empty slots the editor itself can create, so a
 * user is not told "predicate must be snake_case" about a field they never
 * filled in.
 * @returns {string[]}
 */
export function describeProblems(node, path = '$') {
  if (!node || typeof node !== 'object') return [`${path}: incomplete`];
  const out = [];
  switch (node.kind) {
    case 'claim': {
      if (!node.subject?.name?.trim()) out.push(`${path}: subject is empty`);
      const predicate = String(node.predicate ?? '');
      if (!predicate.trim()) out.push(`${path}: predicate is empty`);
      else if (!/^[a-z][a-z0-9_]*$/.test(predicate))
        out.push(`${path}: predicate must be snake_case, e.g. reduces or is_true`);
      if (typeof node.object === 'string' && !node.object.trim())
        out.push(`${path}: object is empty`);
      break;
    }
    case 'framed': {
      const spec = FRAME_FIELDS[node.frame?.kind];
      if (spec?.required) {
        const value = node.frame?.[spec.field];
        const blank = spec.entity ? !value?.name?.trim() : !String(value ?? '').trim();
        if (blank) out.push(`${path}: ${spec.label.toLowerCase()} is required for this frame`);
      }
      out.push(...describeProblems(node.body, `${path}.body`));
      break;
    }
    case 'all':
      (node.parts ?? []).forEach((p, i) => out.push(...describeProblems(p, `${path}.parts[${i}]`)));
      break;
    case 'either': {
      const options = node.options ?? [];
      options.forEach((o, i) => out.push(...describeProblems(o, `${path}.options[${i}]`)));
      // Projection stops at every either, so duplicate options would let an
      // assertion hide inside a choice nobody has to rule on.
      const seen = new Set(options.map((o) => JSON.stringify(pruneTerm(o))));
      if (options.length >= 2 && seen.size < 2) out.push(`${path}: options must be different`);
      break;
    }
    case 'denial':
      out.push(...describeProblems(node.body, `${path}.body`));
      break;
    case 'conditional':
      out.push(...describeProblems(node.when, `${path}.when`));
      out.push(...describeProblems(node.then, `${path}.then`));
      break;
    case 'concession':
      out.push(...describeProblems(node.even_if, `${path}.even_if`));
      out.push(...describeProblems(node.still, `${path}.still`));
      break;
    default:
      out.push(`${path}: unknown node kind`);
  }
  return out;
}

/** A short plain-English rendering, so the author can read back what they built. */
export function describeTerm(node) {
  if (!node || typeof node !== 'object') return '…';
  switch (node.kind) {
    case 'claim': {
      const subject = node.subject?.name || '…';
      const predicate = node.predicate || '…';
      const object =
        typeof node.object === 'string' ? node.object || '…' : JSON.stringify(node.object);
      return `${subject} ${predicate} ${object}`;
    }
    case 'framed': {
      const spec = FRAME_FIELDS[node.frame?.kind];
      const value = spec?.entity ? node.frame?.[spec.field]?.name : node.frame?.[spec.field];
      const lead =
        {
          attribution: `${value || 'the source'} says that`,
          belief: `${value || 'someone'} believes that`,
          hypothetical: 'suppose that',
          hedge: `${value || 'possibly'},`,
          evaluative: 'as a judgement,',
          temporal: `${value || 'at some time'},`,
          domain: `in ${value || 'some domain'},`
        }[node.frame?.kind] || '';
      return `${lead} ${describeTerm(node.body)}`.trim();
    }
    case 'all':
      return (node.parts ?? []).map(describeTerm).join(' and ');
    case 'either':
      return (node.options ?? []).map(describeTerm).join(' or ');
    case 'denial':
      return `it is not the case that ${describeTerm(node.body)}`;
    case 'conditional':
      return `if ${describeTerm(node.when)} then ${describeTerm(node.then)}`;
    case 'concession':
      return `even if ${describeTerm(node.even_if)}, ${describeTerm(node.still)} still holds`;
    default:
      return '…';
  }
}
