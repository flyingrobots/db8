// Format guidance for agents seated through the db8 MCP server.
//
// The example below is exported so a test can push it through the server's own
// SubmissionIn schema: guidance that shows an invalid claim would teach every
// agent to fail its first submission.

export const EXAMPLE_CLAIMS = [
  {
    id: 'c1',
    term: {
      kind: 'framed',
      frame: { kind: 'domain', restriction: 'full-time office workers in the US' },
      body: {
        kind: 'claim',
        subject: { kind: 'named', name: 'remote work' },
        predicate: 'reduces',
        object: 'commute time'
      }
    },
    support: [{ kind: 'citation', ref: 'https://example.org/commute-study' }]
  },
  {
    id: 'c2',
    term: {
      kind: 'framed',
      frame: { kind: 'attribution', source: { kind: 'named', name: 'my opponent' } },
      body: {
        kind: 'claim',
        subject: { kind: 'named', name: 'remote work' },
        predicate: 'lowers',
        object: 'team productivity'
      }
    },
    support: [{ kind: 'logic', ref: 'restating the opposing turn from round 0' }]
  }
];

export const EXAMPLE_CITATIONS = [
  { url: 'https://example.org/commute-study', title: 'Commute time survey' },
  { url: 'https://example.org/productivity-review', title: 'Productivity review' }
];

export const GUIDE = `# Writing a db8 turn

A turn has three parts:

- \`content\`: your argument as prose, 1 to 4000 characters.
- \`claims\`: 1 to 5 structured claims. Each claim is \`{id, term, support}\`.
- \`citations\`: at least 2 sources, each \`{url, title?}\`. The url must be a full URL.

## Claim terms

A term is a tree. \`claim\` is the only leaf:

    {"kind": "claim", "subject": <entity>, "predicate": "snake_case_verb", "object": <any JSON value>}

An entity is \`{"kind": "named", "name": "..."}\` or \`{"kind": "anonymous", "localId": "..."}\`.

Interior nodes:

| kind | fields | meaning |
| --- | --- | --- |
| framed | frame, body | read body under a context |
| all | parts[] (1+) | every part is asserted |
| either | options[] (2+, distinct) | an open choice; nothing in it is asserted |
| denial | body | you deny body |
| conditional | when, then | then applies if when holds; neither is asserted |
| concession | even_if, still | still holds even if even_if is granted |

Frames (\`frame.kind\`):

- Opaque (nothing inside is asserted): \`attribution\` {source: entity}, \`belief\` {holder: entity},
  \`hypothetical\` {premise?}, \`hedge\` {expression}, \`evaluative\` {standard?}.
- Transparent (still asserted, but narrowed): \`temporal\` {at? and/or expression?}, \`domain\` {restriction}.

Use an opaque frame when you report what someone else says ("my opponent claims ...").
Fact-checkers rule only on what you assert, so a frame changes what you can be held to.

\`support\` is a list of \`{kind: "citation" | "logic" | "data", ref}\` with at least one entry.

Limits: depth 16, 256 nodes per term. Predicates must match ^[a-z][a-z0-9_]*$.

## Worked example

claims:

${JSON.stringify(EXAMPLE_CLAIMS, null, 2)}

citations:

${JSON.stringify(EXAMPLE_CITATIONS, null, 2)}

If the server rejects a term, the error names the claim and the path inside its term
(for example \`$.body.predicate\`). Fix that node and submit again.
`;

export const AGENT_LOOP = `You hold one seat in a db8 debate. Repeat until the debate is final and you have voted:

1. Call debate_status. Read the topic, your seat, the phase, and the published transcript.
2. If the phase is "submit" and you have not submitted this round, write your turn and call
   debate_submit. Read the db8://guide resource first if you are unsure of the claim format.
3. If the phase is "published", read the other turns, then call debate_vote_continue with
   "continue" or "end".
4. If the phase is "final", call debate_vote_final once, then stop.
5. Otherwise call debate_wait and go back to step 1.

Your opponents cannot see your turn until the round publishes, and you cannot see theirs.
`;
