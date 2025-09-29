import { readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function applyFile(client, filePath) {
  const sql = await readFile(filePath, 'utf8');
  if (sql.trim().length === 0) return;
  await client.query(sql);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8';
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const schemaPath = path.join(rootDir, 'db', 'schema.sql');
  const rpcPath = path.join(rootDir, 'db', 'rpc.sql');

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    if (await fileExists(schemaPath)) await applyFile(client, schemaPath);
    if (await fileExists(rpcPath)) await applyFile(client, rpcPath);
  } finally {
    await client.end();
  }
}

main()
  .then(() => {
    if (process.env.DB8_TEST_OUTPUT !== 'quiet') {
      console.warn('database prepared');
    }
  })
  .catch((err) => {
    console.error('database preparation failed', err);
    process.exitCode = 1;
  });
