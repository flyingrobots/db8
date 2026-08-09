import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const installer = path.join(repoRoot, 'scripts', 'install-hooks.js');

function runInstaller(cwd) {
  try {
    const stdout = execFileSync(process.execPath, [installer], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

describe('hook installation', () => {
  // `prepare` previously ended in `|| true`, which swallowed every failure —
  // including a read-only or locked .git/config. Installation then reported
  // success while core.hooksPath was never set, silently disabling the
  // pre-commit and pre-push checks in a perfectly valid checkout.
  it('configures hooksPath inside a real repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-hooks-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      const res = runInstaller(dir);
      expect(res.code).toBe(0);
      const configured = execFileSync('git', ['config', 'core.hooksPath'], {
        cwd: dir,
        encoding: 'utf8'
      }).trim();
      expect(configured).toBe('.githooks');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits cleanly outside a repository, so container installs still work', () => {
    // The .git of a git worktree is a file pointing outside a container bind mount,
    // so `npm ci` in the test image must not die here.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-no-git-'));
    try {
      expect(runInstaller(dir).code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly when git config cannot be written in a real repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-readonly-hooks-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      // git writes config through a config.lock sibling and renames it, so a
      // read-only config file is not enough — the directory must be
      // unwritable for the write to genuinely fail.
      fs.chmodSync(path.join(dir, '.git'), 0o555);
      const res = runInstaller(dir);
      expect(res.code).not.toBe(0);
    } finally {
      try {
        fs.chmodSync(path.join(dir, '.git'), 0o755);
      } catch {
        // best effort
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('package install scripts', () => {
  it('routes prepare through the installer rather than swallowing failures', () => {
    expect(pkg.scripts.prepare).toContain('install-hooks');
    expect(pkg.scripts.prepare).not.toMatch(/\|\|\s*true/);
  });

  // postinstall IS an install lifecycle script. A bare `npm i` from inside it
  // re-enters that lifecycle and can repeat the repair install.
  it('runs the rollup repair install with --ignore-scripts', () => {
    const postinstall = pkg.scripts.postinstall || '';
    expect(postinstall).toContain('@rollup/rollup-linux-x64-gnu');
    expect(postinstall).toContain('--ignore-scripts');
  });

  it('keeps the rollup repair guarded to linux x64', () => {
    const postinstall = pkg.scripts.postinstall || '';
    expect(postinstall).toContain("process.platform!=='linux'");
    expect(postinstall).toContain("process.arch!=='x64'");
  });
});
