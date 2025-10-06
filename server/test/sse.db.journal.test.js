import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import http from 'node:http';
import { Pool } from 'pg';
// schema/rpc/rls are prepared by scripts/prepare-db.js before test run
import app, { __setDbPool } from '../rpc.js';

const shouldRun =
  process.env.RUN_PGTAP === '1' ||
  process.env.DB8_TEST_PG === '1' ||
  process.env.DB8_TEST_DATABASE_URL;
const dbUrl =
  process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8_test';

const suite = shouldRun ? describe : describe.skip;

suite('SSE /events emits journal on DB NOTIFY', () => {
  let pool;
  let server;
  let port;
  let roomId;

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    __setDbPool(pool);

    // Schema/RPC/RLS are loaded by scripts/prepare-db.js prior to tests.

    const rc = await pool.query('select room_create($1) as id', ['Journal SSE Room']);
    roomId = rc.rows[0].id;

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
  });

  afterAll(async () => {
    __setDbPool(null);
    if (server) await new Promise((r) => server.close(r));
    if (pool) await pool.end();
  });

  it('receives a journal event after journal_upsert', async () => {
    const sseUrl = `http://127.0.0.1:${port}/events?room_id=${encodeURIComponent(roomId)}`;
    const expectedHash = 'f'.repeat(64);

    const got = await new Promise((resolve, reject) => {
      const req = http.request(
        sseUrl,
        { method: 'GET', headers: { accept: 'text/event-stream' } },
        (res) => {
          res.setEncoding('utf8');
          let buf = '';
          let sawTimer = false;
          const onData = async (chunk) => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
              const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
              if (!dataLine) continue;
              const type = evLine ? evLine.slice(7).trim() : 'message';
              const payload = JSON.parse(dataLine.slice(6));
              if (!sawTimer && payload.t === 'timer') {
                sawTimer = true;
                try {
                  await pool.query('select journal_upsert($1,$2,$3,$4::jsonb,$5::jsonb)', [
                    roomId,
                    0,
                    expectedHash,
                    JSON.stringify({}),
                    JSON.stringify({ idx: 0 })
                  ]);
                } catch (e) {
                  res.off('data', onData);
                  res.destroy();
                  return reject(e);
                }
              }
              if (type === 'journal' && payload.t === 'journal' && payload.room_id === roomId) {
                res.off('data', onData);
                res.destroy();
                return resolve(payload);
              }
            }
          };
          res.on('data', onData);
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end();
    });

    expect(got.room_id).toBe(roomId);
    expect(Number.isInteger(got.idx) && got.idx >= 0).toBe(true);
    expect(got.idx).toBe(0);
    expect(/^[0-9a-f]{64}$/.test(got.hash)).toBe(true);
    expect(got.hash).toBe(expectedHash);
  }, 3000);
});
