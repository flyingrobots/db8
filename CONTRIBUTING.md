---
lastUpdated: 2026-08-15
---

# Contributing to db8

## Prerequisites

**Node 22 or newer.** This is a floor, not a preference: `eslint-plugin-unicorn`
evaluates `Set.prototype.union` at module load, and that method does not exist
before Node 22 — so on Node 20 `npm run lint` dies with a `TypeError` before it
lints a single file. The version is pinned in `.nvmrc`, `package.json` engines,
`docker-compose.test.yml`, and all three workflows.

`engines` is advisory — there is no `engine-strict`, so an older Node installs
fine and only fails later, confusingly. Use `nvm use` and you will not hit it.

**Docker** for Postgres. Optional for the unit tests, required for the
database-backed ones.

## Installing

```bash
npm install
npm --prefix web install
```

`.npmrc` sets `legacy-peer-deps=true`. **That is required, not sloppiness.**
`eslint-plugin-react@7.37.5` is the newest release and its peer range stops at
eslint `^9.7`; the range is stale metadata — `react/jsx-key` was verified working
under eslint 10 — but npm refuses to build the tree without the flag. Remove it
when upstream ships an eslint 10 peer. Deleting it breaks `npm ci` in CI.

## Running it

The API and the web app are **separate origins**, and that matters:

```bash
node server/rpc.js                 # API  -> http://localhost:3000
npm --prefix web run dev           # web  -> http://localhost:3001
```

The browser calls the API cross-origin, so the API allow-lists origins. Unset,
`DB8_ALLOWED_ORIGINS` defaults to `http://localhost:3001` and
`http://127.0.0.1:3001`. **Serve the web app from any other host or port and
every request is blocked** with no `Access-Control-Allow-Origin` — the room page
renders a shell with no submission form and the console explains why. See
[docs/Ops.md](docs/Ops.md).

## Tests

```bash
npm test              # full suite, brings up Postgres in Docker
npm run test:inner    # vitest only; assumes a database is already listening
```

`npm test` is the one you want. It runs the suite **twice against the same
database**, and the two passes are not the same check:

1. **Fresh database.** `DB8_TEST_PG` is unset, so the DB-gated suites skip and
   everything else runs against a clean schema.
2. **Same database, DB-gated.** `DB8_TEST_PG=1` turns the gated suites on and
   re-runs everything over the state pass 1 left behind. That second pass is an
   _idempotency gate_: a test that only passes on a pristine database fails here.

So a green first pass and a red second one usually means a test is leaking state
or depending on a fixture another test consumed.

Browser tests are separate and **not** part of `npm test`:

```bash
npm --prefix web exec playwright install chromium   # once
npm --prefix web run test:e2e
```

They are excluded from `npm test` deliberately: it runs on every push through
the pre-push hook, and requiring a browser engine there would make an ordinary
commit depend on a 95MB install. CI does run them — the `browser-tests` job
installs Chromium and uploads traces on failure — so a break is caught before
merge, just not before push.

## Linters

All four must pass; the pre-commit and pre-push hooks enforce them.

```bash
npm run lint            # eslint
npm run lint:md         # markdownlint
npm run lint:spelling   # cspell
npx prettier --check .
```

New words go in `cspell.json`. Its `words` list is **not** alphabetical — it has
a leading group and appends recent additions at the end. Insert near a topical
neighbor rather than re-sorting, or you will produce a hundred-line diff.

## Commits and branches

- Conventional Commits, enforced by `.githooks/commit-msg` and by CI on the PR
  title. The `!` breaking marker is accepted; a `BREAKING CHANGE:` footer is
  preferred for anything user-visible.
- Never rewrite history: no rebase, no squash, no amend, no force.
- Branch before committing; `main` is protected by convention.
- Update `CHANGELOG.md` and any affected docs in the same change.

## Writing tests

Write the failing test first. If a test passes the moment you write it, it has
proved nothing yet — mutate the code it covers and confirm it goes red.

For anything with two persistence adapters, put the assertion in the **shared
contract suite** (`server/test/verdict.store.contract.test.js`) rather than
testing one adapter. Two of this project's real bugs were adapters disagreeing,
and both were invisible until one spec ran against both.
