import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPersistentSigningKeys } from '../utils.js';

const execFile = promisify(_execFile);

// The journal signer persists an Ed25519 pair to disk so restarts keep signing
// with the same identity. Getting that wrong is not an availability problem, it is
// a provenance problem: a mismatched or silently replaced pair makes every
// journal signature unverifiable, permanently, with no error at signing time.
describe('persistent signing keys', () => {
  let dir;
  let privPath;
  let pubPath;
  const saved = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db8-keys-'));
    privPath = path.join(dir, 'key');
    pubPath = path.join(dir, 'key.pub');
    saved.priv = process.env.SIGNING_PRIVATE_KEY;
    saved.pub = process.env.SIGNING_PUBLIC_KEY;
    delete process.env.SIGNING_PRIVATE_KEY;
    delete process.env.SIGNING_PUBLIC_KEY;
    process.env.SIGNING_PRIVATE_KEY_PATH = privPath;
    process.env.SIGNING_PUBLIC_KEY_PATH = pubPath;
  });

  afterEach(() => {
    delete process.env.SIGNING_PRIVATE_KEY_PATH;
    delete process.env.SIGNING_PUBLIC_KEY_PATH;
    if (saved.priv !== undefined) process.env.SIGNING_PRIVATE_KEY = saved.priv;
    if (saved.pub !== undefined) process.env.SIGNING_PUBLIC_KEY = saved.pub;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function pairMatches(privPem, pubPem) {
    const derived = crypto
      .createPublicKey(crypto.createPrivateKey(privPem))
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    const given = crypto
      .createPublicKey(pubPem)
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    return derived === given;
  }

  it('generates a matching pair when none exists', () => {
    const keys = getPersistentSigningKeys();
    expect(pairMatches(keys.privateKeyPem, keys.publicKeyPem)).toBe(true);
    expect(fs.existsSync(privPath)).toBe(true);
    expect(fs.existsSync(pubPath)).toBe(true);
  });

  it('writes the private key with owner-only permissions', () => {
    getPersistentSigningKeys();
    expect(fs.statSync(privPath).mode & 0o777).toBe(0o600);
  });

  it('returns what is on disk on a second call rather than regenerating', () => {
    const first = getPersistentSigningKeys();
    const second = getPersistentSigningKeys();
    expect(second.privateKeyPem).toBe(first.privateKeyPem);
    expect(second.publicKeyPem).toBe(first.publicKeyPem);
  });

  it('returns the persisted pair, not an in-memory one, when both exist', () => {
    getPersistentSigningKeys();
    const keys = getPersistentSigningKeys();
    expect(keys.privateKeyPem).toBe(fs.readFileSync(privPath, 'utf8'));
    expect(keys.publicKeyPem).toBe(fs.readFileSync(pubPath, 'utf8'));
  });

  // The regression this file exists for. Concurrent starters all saw no key,
  // each generated its own pair, and each wrote private and public in two
  // separate non-atomic steps — so the surviving files could come from
  // different pairs, and every process kept using its own in-memory pair
  // regardless of what landed on disk.
  it('converges on one pair when many processes start at once', async () => {
    const script = `
      import { getPersistentSigningKeys } from ${JSON.stringify(path.resolve('server/utils.js'))};
      const k = getPersistentSigningKeys();
      process.stdout.write(k.publicKeyPem);
    `;
    const runs = Array.from({ length: 12 }, () =>
      execFile(process.execPath, ['--input-type=module', '-e', script], {
        env: {
          ...process.env,
          SIGNING_PRIVATE_KEY_PATH: privPath,
          SIGNING_PUBLIC_KEY_PATH: pubPath
        }
      })
    );
    const results = await Promise.all(runs);
    const reported = results.map((r) => r.stdout.trim());

    // Every process must agree.
    expect(new Set(reported).size).toBe(1);

    // And what they agreed on must be what is actually persisted, and must
    // genuinely correspond to the persisted private key.
    const diskPriv = fs.readFileSync(privPath, 'utf8');
    const diskPub = fs.readFileSync(pubPath, 'utf8');
    expect(reported[0]).toBe(diskPub.trim());
    expect(pairMatches(diskPriv, diskPub)).toBe(true);
  });

  it('rebuilds a missing public half instead of replacing the private key', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(privPath, privateKey, { mode: 0o600 });

    const keys = getPersistentSigningKeys();
    // The private key is the source of truth and must survive: regenerating the
    // pair here would strand every journal it had already signed.
    expect(fs.readFileSync(privPath, 'utf8')).toBe(privateKey);
    expect(keys.privateKeyPem).toBe(privateKey);
    // The public half is derivable, so recovery is exact rather than a guess.
    expect(pairMatches(keys.privateKeyPem, keys.publicKeyPem)).toBe(true);
    expect(fs.existsSync(pubPath)).toBe(true);
  });

  it('refuses when only the public half is present', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(pubPath, publicKey);

    // A private key cannot be recovered from a public one. Generating a fresh
    // pair here would silently invalidate everything ever signed under the
    // published key, which is the failure mode worth being loud about.
    expect(() => getPersistentSigningKeys()).toThrow(/private/i);
  });

  it('rejects a persisted pair whose halves do not correspond', () => {
    const a = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const b = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(privPath, a.privateKey, { mode: 0o600 });
    fs.writeFileSync(pubPath, b.publicKey);

    // Signing with a and publishing b produces signatures nothing can verify.
    // Failing loudly at startup beats discovering it in an audit.
    expect(() => getPersistentSigningKeys()).toThrow(/match/i);
  });

  it('still prefers explicitly configured environment keys', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    process.env.SIGNING_PRIVATE_KEY = privateKey;
    process.env.SIGNING_PUBLIC_KEY = publicKey;
    const keys = getPersistentSigningKeys();
    expect(keys.privateKeyPem).toBe(privateKey);
    expect(fs.existsSync(privPath)).toBe(false);
  });
});
