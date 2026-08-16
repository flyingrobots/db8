import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// `rooms.config` exists, is read by three features, and was never written.
//
// `room_create` reads `p_cfg` for `participant_count` and `submit_minutes`
// (db/rpc.sql:16-17) and then inserts only `(title, client_nonce)`, so every
// room in every database has `config = '{}'`. Three things depend on it and are
// therefore inert:
//
//   - research quotas       — server/routes/research.js reads max_fetches_per_round
//   - attribution masking   — submissions_view reads attribution_mode
//   - strict vocabularies   — validateTerm(term, { predicates }) has nowhere to
//                             read a room's declared predicate set from
//
// The research test only passes today because it hand-inserts a config row.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';

const describeDb = process.env.DB8_TEST_PG === '1' ? describe : describe.skip;

describeDb('room_create persists the configuration it was given', () => {
  let pool;
  const nonces = [];

  const createRoom = async (topic, cfg, nonce) => {
    nonces.push(nonce);
    const r = await pool.query('select room_create($1::text, $2::jsonb, $3::text) as id', [
      topic,
      JSON.stringify(cfg),
      nonce
    ]);
    return r.rows[0].id;
  };

  const configOf = async (roomId) =>
    (await pool.query('select config from rooms where id = $1', [roomId])).rows[0].config;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
  });

  afterAll(async () => {
    await pool.query('delete from rooms where client_nonce = any($1)', [nonces]);
    await pool.end();
  });

  it('stores the keys it already reads for its own behaviour', async () => {
    const roomId = await createRoom(
      'Config Room',
      { participant_count: 6, submit_minutes: 9 },
      'cfg-persist-known-keys'
    );
    expect(await configOf(roomId)).toMatchObject({ participant_count: 6, submit_minutes: 9 });
  });

  it('stores the keys other features read but room_create does not', async () => {
    // These are the three inert features. room_create does not interpret them;
    // it only has to not discard them.
    const cfg = {
      attribution_mode: 'masked',
      max_fetches_per_round: 3,
      predicates: ['reduces', 'increases'],
      tags: ['science']
    };
    const roomId = await createRoom('Full Config Room', cfg, 'cfg-persist-other-keys');
    expect(await configOf(roomId)).toMatchObject(cfg);
  });

  it('defaults to an empty object when no config is given', async () => {
    const roomId = await createRoom('Bare Room', {}, 'cfg-persist-empty');
    expect(await configOf(roomId)).toEqual({});
  });

  it('still applies participant_count and submit_minutes to the round it seeds', async () => {
    // Persisting the config must not change what room_create already does with
    // the two keys it interprets.
    const roomId = await createRoom(
      'Seeded Room',
      { participant_count: 3, submit_minutes: 2 },
      'cfg-persist-seeding'
    );
    const participants = await pool.query(
      'select count(*)::int as n from participants where room_id = $1',
      [roomId]
    );
    expect(participants.rows[0].n, 'participant_count seats the roster').toBe(3);

    const round = await pool.query(
      'select submit_deadline_unix from rounds where room_id = $1 and idx = 0',
      [roomId]
    );
    // Two clocks, deliberately loose. The deadline is computed from SQL `now()`
    // — transaction start — while this reads the JS clock afterwards, so the
    // difference rounds either way by a second. The assertion is that
    // submit_minutes was honoured (120s, not the 300s default), not that the
    // two clocks agree; tightening it to an exact bound made it fail at 121.
    const now = Math.floor(Date.now() / 1000);
    const delta = Number(round.rows[0].submit_deadline_unix) - now;
    expect(
      delta,
      'submit_minutes of 2 is a deadline about 120s out, not the 300s default'
    ).toBeGreaterThan(60);
    expect(delta).toBeLessThan(180);
  });

  it('is still idempotent on the client nonce, and keeps the first config', async () => {
    const nonce = 'cfg-persist-idempotent';
    const first = await createRoom('Idempotent Room', { participant_count: 5 }, nonce);
    const second = await createRoom('Idempotent Room', { participant_count: 5 }, nonce);
    expect(second, 'the same nonce returns the same room').toBe(first);
    expect(await configOf(first)).toMatchObject({ participant_count: 5 });
  });
});
