import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalizeSorted, canonicalizeJCS, sha256Hex } from '../utils.js';

// The CLI and the server must agree on what a document canonicalizes to.
//
// They did not. bin/db8.js carried its own canonicalizer whose `sorted` branch
// was `JSON.stringify(value, Object.keys(value).sort())` — and a replacer ARRAY
// is an allow-list applied at EVERY depth, not a top-level key order. So nested
// keys were deleted outright:
//
//   CLI    : {"body":{"kind":"claim"},"frame":{"kind":"attribution"},"kind":"framed"}
//   SERVER : {"body":{"kind":"claim","object":"productivity",…},"frame":{…},"kind":"framed"}
//
// Every claim and citation in a real submission collapsed to `{}`, so two
// entirely different arguments produced the same digest. docs/Provenance.md
// specifies the signature is over the SHA-256 of the canonicalized document, and
// the only digest db8 hands a user is the CLI's — so anything signed under
// `sorted` failed server-side verification, every time.

const named = (name) => ({ kind: 'named', name });
const CLAIM_TERM = {
  kind: 'framed',
  frame: { kind: 'attribution', source: named('the_study') },
  body: {
    kind: 'claim',
    subject: named('remote_work'),
    predicate: 'reduces',
    object: 'productivity'
  }
};

const DOC = {
  room_id: '00000000-0000-0000-0000-000000000001',
  round_id: '00000000-0000-0000-0000-000000000002',
  author_id: '00000000-0000-0000-0000-000000000003',
  phase: 'submit',
  deadline_unix: 4102444800,
  content: 'The evidence on remote work is contested.',
  claims: [{ id: 'c1', term: CLAIM_TERM, support: [{ kind: 'logic', ref: 'analysis' }] }],
  citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
  client_nonce: 'fixednonce123'
};

const repoRoot = process.cwd();

// Runs the real binary, because the bug lived in the binary's own copy and a
// unit test against an imported helper would not have seen it.
function cliDigest(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-canon-'));
  const file = path.join(dir, 'draft.json');
  try {
    fs.writeFileSync(file, JSON.stringify(DOC));
    const out = execFileSync(
      process.execPath,
      [
        path.join(repoRoot, 'bin', 'db8.js'),
        'draft',
        'validate',
        '--path',
        file,
        '--nonce',
        DOC.client_nonce,
        '--json'
      ],
      { encoding: 'utf8', env: { ...process.env, CANON_MODE: mode, DB8_CANON_MODE: mode } }
    );
    return JSON.parse(out).canonical_sha256;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function serverDigest(mode) {
  const canon = mode === 'sorted' ? canonicalizeSorted : canonicalizeJCS;
  // The CLI validates the document it was given; match that shape exactly.
  return sha256Hex(canon(DOC));
}

describe('the CLI and the server canonicalize identically', () => {
  for (const mode of ['jcs', 'sorted']) {
    it(`agrees on the digest of a nested claim term in ${mode} mode`, () => {
      expect(cliDigest(mode)).toBe(serverDigest(mode));
    });
  }

  // The failure mode was silent because the two digests were never compared.
  it('produces different digests for different claims, in both modes', () => {
    const other = JSON.parse(JSON.stringify(DOC));
    other.claims[0].term.body.predicate = 'increases';
    for (const mode of ['jcs', 'sorted']) {
      const canon = mode === 'sorted' ? canonicalizeSorted : canonicalizeJCS;
      expect(sha256Hex(canon(DOC)), mode).not.toBe(sha256Hex(canon(other)));
    }
  });

  // The server rejects an unrecognized mode; the CLI silently took the broken
  // branch for anything that was not exactly 'jcs', so a one-character typo
  // produced content-erasing digests.
  it('rejects an unrecognized mode rather than falling into a branch', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-canon-bad-'));
    const file = path.join(dir, 'draft.json');
    try {
      fs.writeFileSync(file, JSON.stringify(DOC));
      let failed = false;
      try {
        execFileSync(
          process.execPath,
          [
            path.join(repoRoot, 'bin', 'db8.js'),
            'draft',
            'validate',
            '--path',
            file,
            '--nonce',
            DOC.client_nonce,
            '--json'
          ],
          {
            encoding: 'utf8',
            stdio: 'pipe',
            env: { ...process.env, CANON_MODE: 'jsc', DB8_CANON_MODE: 'jsc' }
          }
        );
      } catch {
        failed = true;
      }
      expect(failed, 'a typo in the canon mode should not be accepted').toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the CLI hashes what it sends', () => {
  // Zod strips properties the schema does not declare, and the server hashes the
  // *parsed* value. Hashing the raw draft here made the digests disagree for any
  // draft carrying an extra property — and the mismatch check then reported a
  // failure on a submission that had actually succeeded.
  it('agrees with the server for a draft carrying an undeclared property', () => {
    const withExtra = JSON.parse(JSON.stringify(DOC));
    withExtra.claims[0].note = 'an editor left this here';

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-extra-'));
    const file = path.join(dir, 'draft.json');
    try {
      fs.writeFileSync(file, JSON.stringify(withExtra));
      const out = execFileSync(
        process.execPath,
        [
          path.join(repoRoot, 'bin', 'db8.js'),
          'submit',
          '--path',
          file,
          '--dry-run',
          '--nonce',
          DOC.client_nonce,
          '--json'
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            CANON_MODE: 'jcs',
            DB8_CANON_MODE: 'jcs',
            DB8_ROOM_ID: DOC.room_id,
            DB8_PARTICIPANT_ID: DOC.author_id,
            DB8_JWT: 'unused-for-dry-run'
          }
        }
      );
      // The server would strip `note` before hashing, so the CLI must too.
      expect(JSON.parse(out).canonical_sha256).toBe(serverDigest('jcs'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Automation retrying EXIT.NETWORK would retry a permanent misconfiguration
  // forever, so a bad mode has to be classified as validation.
  it('exits with the validation code, not the network code, on a bad mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-exit-'));
    const file = path.join(dir, 'draft.json');
    try {
      fs.writeFileSync(file, JSON.stringify(DOC));
      let status = 0;
      try {
        execFileSync(
          process.execPath,
          [
            path.join(repoRoot, 'bin', 'db8.js'),
            'submit',
            '--path',
            file,
            '--dry-run',
            '--nonce',
            DOC.client_nonce
          ],
          {
            encoding: 'utf8',
            stdio: 'pipe',
            env: {
              ...process.env,
              DB8_CANON_MODE: 'jsc',
              DB8_ROOM_ID: DOC.room_id,
              DB8_PARTICIPANT_ID: DOC.author_id,
              DB8_JWT: 'unused-for-dry-run'
            }
          }
        );
      } catch (err) {
        status = err.status;
      }
      expect(status, 'EXIT.VALIDATION is 2, EXIT.NETWORK is 7').toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
