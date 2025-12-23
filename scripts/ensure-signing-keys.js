import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function fileExistsNonEmpty(p) {
  try {
    return fs.statSync(p).isFile() && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!dir || dir === '.') return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writeFileAtomic(filePath, contents, mode) {
  ensureDirForFile(filePath);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, contents, { mode });
    fs.renameSync(tmpPath, filePath);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

export function ensureSigningKeys() {
  const privPath = process.env.SIGNING_PRIVATE_KEY_PATH || './.db8_signing_key';
  const pubPath = process.env.SIGNING_PUBLIC_KEY_PATH || './.db8_signing_key.pub';

  if (fileExistsNonEmpty(privPath) && fileExistsNonEmpty(pubPath)) return { privPath, pubPath };

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  writeFileAtomic(privPath, privateKey, 0o600);
  writeFileAtomic(pubPath, publicKey, 0o644);
  return { privPath, pubPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSigningKeys();
}
