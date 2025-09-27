import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const execFile = promisify(_execFile);

function cliBin() {
  return path.join(process.cwd(), 'bin', 'db8.js');
}

const ROOM_ID = '00000000-0000-0000-0000-000000000001';
const PARTICIPANT_ID = '00000000-0000-0000-0000-000000000002';
async function writeDraft(baseDir, content) {
  const draftDir = path.join(baseDir, 'db8', 'round-0', 'anon');
  await fs.mkdir(draftDir, { recursive: true });
  const draftPath = path.join(draftDir, 'draft.json');
  const draft = {
    phase: 'OPENING',
    deadline_unix: 0,
    content,
    claims: [
      {
        id: 'c1',
        text: 'Claim text',
        support: [{ kind: 'logic', ref: 'support-1' }]
      }
    ],
    citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }]
  };
  await fs.writeFile(draftPath, JSON.stringify(draft, null, 2));
  return draftPath;
}

describe('CLI submit --dry-run', () => {
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db8-cli-submit-'));
  });

  afterAll(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('emits canonical hash without performing network call', async () => {
    const draftPath = await writeDraft(tmpDir, 'Hello dry run');
    const nonce = 'nonce-dryrun-12345';

    const validate = await execFile(
      'node',
      [
        cliBin(),
        'draft',
        'validate',
        '--path',
        draftPath,
        '--room',
        ROOM_ID,
        '--participant',
        PARTICIPANT_ID,
        '--nonce',
        nonce,
        '--json'
      ],
      { cwd: tmpDir }
    );
    const validateJson = JSON.parse(validate.stdout.trim());

    const { stdout } = await execFile(
      'node',
      [
        cliBin(),
        'submit',
        '--dry-run',
        '--room',
        ROOM_ID,
        '--participant',
        PARTICIPANT_ID,
        '--path',
        draftPath,
        '--nonce',
        nonce,
        '--round',
        '0',
        '--json'
      ],
      { cwd: tmpDir }
    );
    const result = JSON.parse(stdout.trim());
    expect(result.ok).toBe(true);
    expect(result.dry_run).toBe(true);
    expect(result.canonical_sha256).toEqual(validateJson.canonical_sha256);
    expect(result.client_nonce).toEqual(nonce);
  });
});
