import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// room_create stores the configuration it is given as rooms.config (#200).
// Three features read keys that room_create itself does not interpret:
//
//   - research quotas       — server/routes/research.js reads max_fetches_per_round
//   - attribution masking   — submissions_view reads attribution_mode
//   - strict vocabularies   — submission.create reads predicates (#244)
//
// Before #200 it stored only (title, client_nonce), so all three were inert.

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
    const empty = await createRoom('Bare Room', {}, 'cfg-persist-empty');
    expect(await configOf(empty), 'an empty object').toEqual({});

    nonces.push('cfg-persist-null');
    const nulled = await pool.query('select room_create($1::text, NULL::jsonb, $2::text) as id', [
      'Null Config Room',
      'cfg-persist-null'
    ]);
    expect(await configOf(nulled.rows[0].id), 'a NULL config').toEqual({});

    nonces.push('cfg-persist-omitted');
    const omitted = await pool.query(
      'select room_create(p_topic => $1::text, p_client_nonce => $2::text) as id',
      ['Omitted Config Room', 'cfg-persist-omitted']
    );
    expect(await configOf(omitted.rows[0].id), 'an omitted config').toEqual({});
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
    // The replay asks for a different config. It is a retry, not a
    // reconfiguration (#249): the stored config and the roster stay as created.
    const nonce = 'cfg-persist-idempotent';
    const first = await createRoom('Idempotent Room', { participant_count: 5 }, nonce);
    const second = await createRoom(
      'Idempotent Room',
      { participant_count: 2, attribution_mode: 'masked' },
      nonce
    );
    expect(second, 'the same nonce returns the same room').toBe(first);
    expect(await configOf(first)).toEqual({ participant_count: 5 });
    const seats = await pool.query(
      'select count(*)::int as n from participants where room_id = $1',
      [first]
    );
    expect(seats.rows[0].n, 'the replay does not change the roster').toBe(5);
  });
});
