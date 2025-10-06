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

suite('SSE /events is DB-backed (LISTEN/NOTIFY)', () => {
  let pool;
  let server;
  let port;
  let roomId;
  let roundId;

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    __setDbPool(pool);

    // Schema/RPC/RLS are loaded by scripts/prepare-db.js prior to tests.

    // Create a room/round via RPC and fetch the current round via the secure view
    const rc = await pool.query('select room_create($1) as id', ['SSE Test Room']);
    roomId = rc.rows[0].id;
    const cur = await pool.query(
      `select room_id, round_id, idx, phase, submit_deadline_unix
         from view_current_round
        where room_id = $1`,
      [roomId]
    );
    if (cur.rows.length === 0) throw new Error(`No current round found for room ${roomId}`);
    roundId = cur.rows[0].round_id;

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
                // Simulate a round phase change via NOTIFY without raw table writes
                try {
                  const now = Math.floor(Date.now() / 1000);
                  // Re-read current round details from the secure view for payload fields
                  const cur2 = await pool.query(
                    `select room_id, round_id, idx, submit_deadline_unix
                       from view_current_round
                      where room_id = $1
                      order by idx desc
                      limit 1`,
                    [roomId]
                  );
                  await pool.query(
                    `select pg_notify('db8_rounds', json_build_object(
                      't','phase',
                      'room_id',$1::text,
                      'round_id',$2::text,
                      'idx',$3::int,
                      'phase','published',
                      'submit_deadline_unix',$4::bigint,
                      'published_at_unix',$5::bigint,
                      'continue_vote_close_unix',$6::bigint
                    )::text)`,
                    [
                      roomId,
                      roundId,
                      cur2.rows[0].idx,
                      cur2.rows[0].submit_deadline_unix,
                      now,
                      now + 2
                    ]
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
