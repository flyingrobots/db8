import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const installer = path.join(repoRoot, 'scripts', 'install-hooks.js');

// git exports GIT_DIR (and friends) to the hooks it runs; from a linked
// worktree GIT_DIR is absolute. Inherited by the commands below, it pointed them
// at the developer's repository instead of the temporary one (#239), so every
// git call and installer run here gets an environment without GIT_* variables.
function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
}
const git = (args, cwd, opts = {}) => execFileSync('git', args, { cwd, env: cleanEnv(), ...opts });

function runInstaller(cwd) {
  try {
    const stdout = execFileSync(process.execPath, [installer], {
      cwd,
      env: cleanEnv(),
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
      git(['init', '-q'], dir);
      const res = runInstaller(dir);
      expect(res.code).toBe(0);
      const configured = git(['config', 'core.hooksPath'], dir, { encoding: 'utf8' }).trim();
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
      git(['init', '-q'], dir);
      // Hold the config lock. git writes config through a config.lock sibling
      // and refuses when one already exists, so this fails for any user —
      // unlike chmod, which root ignores, and the test container runs as root.
      fs.writeFileSync(path.join(dir, '.git', 'config.lock'), '');
      const res = runInstaller(dir);
      expect(res.code).not.toBe(0);
    } finally {
      try {
        fs.unlinkSync(path.join(dir, '.git', 'config.lock'));
      } catch {
        // best effort
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('hook installation under an inherited GIT_DIR', () => {
  it('touches only the temporary repository, as when run from a hook in a worktree', () => {
    const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-decoy-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-hooks-env-'));
    const saved = process.env.GIT_DIR;
    try {
      git(['init', '-q'], decoy);
      process.env.GIT_DIR = path.join(decoy, '.git');
      git(['init', '-q'], dir);
      expect(runInstaller(dir).code).toBe(0);
      expect(fs.existsSync(path.join(dir, '.git', 'config'))).toBe(true);
      expect(git(['config', 'core.hooksPath'], dir, { encoding: 'utf8' }).trim()).toBe('.githooks');
      // The repository the inherited GIT_DIR named is left alone.
      expect(() =>
        git(['config', 'core.hooksPath'], decoy, { encoding: 'utf8', stdio: 'pipe' })
      ).toThrow();
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
      fs.rmSync(decoy, { recursive: true, force: true });
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
