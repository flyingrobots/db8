---
lastUpdated: 2026-08-16
---

# ADR-0002: Record the `sorted` canonicalization divergence rather than fix it

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** James Ross

## Context

db8 has two canonicalization modes. `jcs` is RFC 8785, delegated to the
`canonicalize` package, and is the default. `sorted` is the legacy M1 form,
documented as deprecated, implemented as `canonicalizeSorted` in
`server/utils.js`.

While replacing two tautological canonicalization tests with spec-derived
vectors — the previous ones asserted `canonicalizeJCS(x)` equalled the library
it delegates to, which is `lib(x) === lib(x)` and cannot fail — calibration
turned up a defect nobody had noticed:

```js
for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
```

That reads as lexicographic ordering. It is not. An integer-like key is an array
index to JavaScript, and integer-index properties are emitted **first, in
ascending numeric order**, whatever order they were assigned. The `.sort()` is
silently overridden for that entire class of key:

```text
input   {"2":"two","10":"ten"}
sorted  {"2":"two","10":"ten"}   <- numeric order
JCS     {"10":"ten","2":"two"}   <- code-unit order, per RFC 8785
```

It is reachable. A claim term's `object` is arbitrary JSON, so numeric string
keys reach the canonicalizer and therefore the signed digest.

The severity is narrower than it first looks. The output is still
**deterministic** — the same document always produces the same bytes regardless
of key insertion order — so db8 always agrees with itself and its own signatures
verify. What breaks is **interoperability**: any independent implementation of
`sorted` that does a real lexicographic sort computes a different digest for the
same document and fails verification. That is precisely the class of divergence
that already shipped once between the CLI and the server.

Fixing it changes the canonical bytes, and therefore the digest, and therefore
every signature over any document containing a numeric key.

## Decision

**Do not change the behaviour.** Record it as a labelled divergence in the test
suite, with the determinism guarantee asserted separately so it cannot be lost if
the divergence is later resolved.

The test is explicitly marked as **change detection, not specification** — it
pins what the code does today so a silent change is caught, while stating in the
same breath that this is not the behaviour we want.

Resolving it is a breaking change to signed material and belongs to a deliberate
migration, not to a test-repair commit that happened to find it.

## Consequences

**Better.** The divergence is visible instead of latent. A reader of
`canonicalizeSorted` now finds the explanation next to the code, rather than
discovering it when a second implementation fails to verify a db8 signature. The
determinism property — the one that actually carries the signing weight — is
pinned on its own and cannot be accidentally traded away while fixing the
ordering.

**Worse.** db8 ships a canonical form that is not implementable from its own
name. Anyone writing a `sorted` verifier in another language will get it wrong,
and will have no way to know until a signature fails. Until this is resolved,
`sorted` is effectively "JavaScript own-property order" wearing a misleading
label.

**Now load-bearing.** The labelled test. If someone "cleans it up" by deleting a
test that asserts apparently-wrong behaviour, the divergence goes back to being
invisible. The comment above it says so, at length, for exactly that reason.

**Must stay true.** That `jcs` remains the default. The defect is confined to a
deprecated mode; if anything started defaulting to `sorted`, the priority changes
immediately.

## Alternatives considered

**Fix it now** — build the JSON string manually rather than relying on object
property order. Rejected for timing, not merit: it invalidates every signature
over a document with numeric keys, needs a `BREAKING CHANGE` footer and a major
bump, and it surfaced during a test-repair commit whose declared kind was
"test repair, no source behaviour changed". Bundling a signature-invalidating
change into that commit would have been dishonest about scope.

**Retire `sorted` entirely.** The most likely correct end state, and the
recommendation carried into the tracking issue. `docs/Provenance.md` already
documents it as deprecated in favour of `jcs`. Not taken here because it needs
confirmation that no deployment holds `CANON_MODE=sorted` signatures worth
preserving — which is a question about the world, not about the code.

**Document it as "JavaScript own-property order" and call it specified.**
Rejected: honest, but it makes the mode permanently unimplementable outside
JavaScript, which defeats the purpose of having a canonical form at all.

**Say nothing.** Rejected. The whole point of a canonical form is that a third
party can recompute it.

## References

- `server/utils.js` — `canonicalizeSorted`
- `server/test/canonicalization.test.js` — the labelled divergence and the
  separate determinism assertion
- [#211](https://github.com/flyingrobots/db8/issues/211) — tracking issue, with
  the three resolution options
- `docs/Provenance.md` — `sorted` documented as deprecated
- ADR-0001 — the same "one implementation of an invariant" principle
