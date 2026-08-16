import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { RoomService } from '../services/RoomService.js';

// `/state` must report the final tally of the round it is reporting on.
//
// `RoomService` reads the continue tally and the final tally two lines apart,
// and only one of them is scoped:
//
//   const tallyRow      = tallyRes.rows.find((r) => r.round_id === roundRow.round_id) || {};
//   const finalTallyRow = finalTallyRes.rows[0] || {};
//
// The final-tally query does not even select `round_id`, so it cannot be
// scoped, and `view_final_tally` groups by (round_id, room_id). A room with
// final votes on more than one round therefore serves an arbitrary round's
// approvals as the current round's result.
//
// The existing coverage seeds a single round, where "arbitrary row" and
// "correct row" are the same row, so it cannot see this.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';

const describeDb = process.env.DB8_TEST_PG === '1' ? describe : describe.skip;

describeDb('/state reports the final tally of the round it is reporting on', () => {
  let pool;

  const roomId = '4a110000-0000-0000-0000-000000000001';
  const oldRoundId = '4a110000-0000-0000-0000-000000000002';
  const currentRoundId = '4a110000-0000-0000-0000-000000000003';
  const voters = [
    '4a110000-0000-0000-0000-000000000010',
    '4a110000-0000-0000-0000-000000000011',
    '4a110000-0000-0000-0000-000000000012'
  ];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.query('insert into rooms(id, title) values ($1,$2)', [roomId, 'Tally Scope Room']);

    // Two rounds in one room. Round 0 is history; round 1 is current, because
    // view_current_round takes the highest idx.
    await pool.query(
      `insert into rounds(id, room_id, idx, phase, published_at_unix) values
         ($1,$3,0,'final',extract(epoch from now())::bigint),
         ($2,$3,1,'final',extract(epoch from now())::bigint)`,
      [oldRoundId, currentRoundId, roomId]
    );
    for (const [i, v] of voters.entries()) {
      await pool.query(
        'insert into participants(id, room_id, anon_name, role) values ($1,$2,$3,$4)',
        [v, roomId, `scope_voter_${i}`, 'debater']
      );
    }

    // Round 0: everyone approves — 3/0.
    for (const v of voters) {
      await pool.query(
        'select vote_final_submit($1::uuid,$2::uuid,$3::boolean,$4::jsonb,$5::text)',
        [oldRoundId, v, true, '[]', `scope-old-${v}`]
      );
    }

    // Round 1: everyone rejects — 0/3. Deliberately the opposite result, so a
    // test reading the wrong round cannot coincidentally pass.
    for (const v of voters) {
      await pool.query(
        'select vote_final_submit($1::uuid,$2::uuid,$3::boolean,$4::jsonb,$5::text)',
        [currentRoundId, v, false, '[]', `scope-current-${v}`]
      );
    }
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.end();
  });

  it('reports the current round, not another round in the same room', async () => {
    const service = new RoomService({ dbRef: { pool } });
    const state = await service.getRoomState(roomId);

    expect(state.ok, `getRoomState -> ${JSON.stringify(state)}`).toBe(true);
    expect(state.round.round_id, 'the current round is the highest idx').toBe(currentRoundId);

    // Round 1 is 0 approve / 3 reject. Round 0 is 3 approve / 0 reject.
    // Reading the wrong row inverts the result of the debate.
    expect(Number(state.round.final_tally.approves), 'approvals for the current round').toBe(0);
    expect(Number(state.round.final_tally.rejects), 'rejections for the current round').toBe(3);
  });

  it('is unaffected by a later round existing when reporting an earlier one', async () => {
    // The mirror case: the view returns rows for both rounds either way, so a
    // correct implementation has to select by round rather than by position.
    const rows = await pool.query(
      'select round_id, approves, rejects from view_final_tally where room_id = $1 order by round_id',
      [roomId]
    );
    expect(rows.rows, 'both rounds appear in the view').toHaveLength(2);

    const old = rows.rows.find((r) => r.round_id === oldRoundId);
    expect(Number(old.approves), 'the earlier round kept its own result').toBe(3);
    expect(Number(old.rejects)).toBe(0);
  });
});
