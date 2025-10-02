import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import http from 'node:http';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import app, { __setDbPool } from '../rpc.js';

const shouldRun = process.env.RUN_PGTAP === '1' || process.env.DB8_TEST_PG === '1';
const dbUrl = process.env.DB8_TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:54329/db8';

const suite = shouldRun ? describe : describe.skip;

suite('SSE /events is DB-backed (LISTEN/NOTIFY)', () => {
  let pool;
  let server;
  let port;
  const roomId = '00000000-0000-0000-0000-0000000000ab';
  const roundId = '00000000-0000-0000-0000-0000000000ac';

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    __setDbPool(pool);

    // Load schema + RPCs if missing (avoid concurrent redefine races)
    const haveRooms = await pool.query("select to_regclass('public.rooms') as reg");
    if (!haveRooms.rows[0]?.reg) {
      const schemaSql = fs.readFileSync(path.resolve('db/schema.sql'), 'utf8');
      await pool.query(schemaSql);
    }
    // Ensure RPCs and triggers exist; use CREATE OR REPLACE so this is idempotent
    const rpcSql = fs.readFileSync(path.resolve('db/rpc.sql'), 'utf8');
    await pool.query(rpcSql);

    await pool.query(
      `insert into rooms (id, title) values ($1,'Test Room') on conflict (id) do nothing`,
      [roomId]
    );
    const deadline = Math.floor(Date.now() / 1000) + 30;
    await pool.query(
      `insert into rounds (id, room_id, idx, phase, submit_deadline_unix)
       values ($1,$2,0,'submit',$3)
       on conflict (id) do update set submit_deadline_unix = excluded.submit_deadline_unix`.replace(
        '\n',
        ' '
      ),
      [roundId, roomId, deadline]
    );

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
  });

  afterAll(async () => {
    __setDbPool(null);
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  it('emits timer based on DB round deadline and reacts to NOTIFY with phase event', async () => {
    const sseUrl = `http://127.0.0.1:${port}/events?room_id=${encodeURIComponent(roomId)}`;

    const got = await new Promise((resolve, reject) => {
      const req = http.request(
        sseUrl,
        { method: 'GET', headers: { accept: 'text/event-stream' } },
        (res) => {
          res.setEncoding('utf8');
          let buf = '';
          const events = [];
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
              events.push({ type, payload });

              // As soon as we see a timer for the room and a subsequent phase event after we
              // flip the round, we can resolve.
              if (events.length === 1 && payload.t === 'timer' && payload.room_id === roomId) {
                // Flip the round to published to trigger NOTIFY and expect a 'phase' event
                try {
                  const now = Math.floor(Date.now() / 1000);
                  await pool.query(
                    `update rounds set phase='published', published_at_unix=$1, continue_vote_close_unix=$2 where id=$3`,
                    [now, now + 2, roundId]
                  );
                } catch (e) {
                  res.off('data', onData);
                  res.destroy();
                  return reject(e);
                }
              }

              if (type === 'phase' && payload.t === 'phase' && payload.room_id === roomId) {
                res.off('data', onData);
                res.destroy();
                resolve(events);
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

    // Validate: first event is timer with correct shape; we later received a phase event from DB NOTIFY
    expect(got[0].payload.t).toBe('timer');
    expect(got[0].payload.room_id).toBe(roomId);
    const phaseEvent = got.find((e) => e.type === 'phase');
    expect(phaseEvent).toBeTruthy();
    expect(phaseEvent.payload.t).toBe('phase');
    expect(phaseEvent.payload.phase).toBe('published');
    expect(phaseEvent.payload.room_id).toBe(roomId);
    expect(phaseEvent.payload.round_id).toBe(roundId);
  }, 5000);
});
