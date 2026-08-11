import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const hook = path.join(repoRoot, '.githooks', 'commit-msg');

// The hook reads the message from a file, the way git invokes it.
function check(message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-commitmsg-'));
  const file = path.join(dir, 'COMMIT_EDITMSG');
  try {
    fs.writeFileSync(file, message);
    execFileSync('bash', [hook, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'ops',
  'sec'
];

describe('commit-msg hook', () => {
  it('accepts every declared type', () => {
    for (const type of TYPES) {
      expect(check(`${type}: do a thing`), type).toBe(true);
    }
  });

  it('accepts a scope', () => {
    expect(check('feat(claims): add a node kind')).toBe(true);
  });

  // Conventional Commits marks a breaking change with `!` before the colon.
  // CI validates the PR title with amannn/action-semantic-pull-request, which
  // accepts it, so a commit the hook refuses would have passed review — the
  // two must agree on the grammar.
  it('accepts the breaking-change marker, with and without a scope', () => {
    expect(check('feat!: drop the flat claim shape')).toBe(true);
    expect(check('feat(claims)!: drop the flat claim shape')).toBe(true);
  });

  it('accepts a body and a BREAKING CHANGE footer', () => {
    expect(
      check('fix(claims)!: correct the projection\n\nBody.\n\nBREAKING CHANGE: it changed.')
    ).toBe(true);
  });

  it('accepts a revert', () => {
    expect(check('revert: feat(claims): add a node kind')).toBe(true);
  });

  it('accepts merge commits, whose messages git generates', () => {
    expect(check("Merge branch 'main' into feat/x")).toBe(true);
    expect(check('Merge pull request #1 from flyingrobots/feat/x')).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(check('wip: something')).toBe(false);
    expect(check('update: something')).toBe(false);
  });

  it('rejects a missing type', () => {
    expect(check('just a message')).toBe(false);
  });

  it('rejects an empty description', () => {
    expect(check('feat: ')).toBe(false);
    expect(check('feat:')).toBe(false);
  });

  // The type must open the subject line. Without an anchor a conforming line
  // anywhere in the body would validate the whole message.
  it('rejects a conforming line that is not the subject', () => {
    expect(check('wip: broken\n\nfeat: this line conforms but is not the subject')).toBe(false);
  });
});
