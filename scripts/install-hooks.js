#!/usr/bin/env node
// Point git at the repository's hooks directory.
//
// Tolerates exactly one condition: not being inside a git worktree. That is the
// legitimate case — the package installed as a dependency, or `npm ci` running
// inside the test container, where the .git of a worktree is a file pointing outside
// the bind mount and git cannot resolve it.
//
// Every other failure propagates. `prepare` previously ended in `|| true`, which
// also swallowed a read-only or locked .git/config, so an ordinary checkout
// could report a successful install while core.hooksPath was never set and the
// pre-commit and pre-push checks were silently inactive.
import { execFileSync } from 'node:child_process';

function insideWorkTree() {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.trim() === 'true';
  } catch {
    // No git on PATH, or not a repository. Both are fine; hooks are a
    // convenience for contributors, not a build requirement.
    return false;
  }
}

if (insideWorkTree()) {
  // Deliberately unguarded: a failure here is a real one and must fail install.
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
}
