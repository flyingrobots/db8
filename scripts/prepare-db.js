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
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const preflightPath = path.join(rootDir, 'db', 'preflight.sql');
  const schemaPath = path.join(rootDir, 'db', 'schema.sql');
  const rpcPath = path.join(rootDir, 'db', 'rpc.sql');
  const rlsPath = path.join(rootDir, 'db', 'rls.sql');
  // Applied here so no test file has to apply DDL at runtime. Each helper
  // self-guards on a *_test database name.
  const helpersPath = path.join(rootDir, 'db', 'test', 'helpers.sql');

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // Committed on its own first: what it records must survive a schema.sql
    // that fails (db/preflight.sql says why).
    if (await fileExists(preflightPath)) await applyFile(client, preflightPath);
    // Schema, RPCs and policies in one transaction. Applied one by one, a
    // schema.sql that changed a key committed while the old functions still
    // targeted the old key, and they failed until rpc.sql followed.
    await client.query('BEGIN');
    try {
      for (const file of [schemaPath, rpcPath, rlsPath]) {
        if (await fileExists(file)) await applyFile(client, file);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    if (await fileExists(helpersPath)) await applyFile(client, helpersPath);
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
