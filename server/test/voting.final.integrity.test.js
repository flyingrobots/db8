import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// One voter, one ballot.
//
// `final_votes` declared UNIQUE (round_id, voter_id, client_nonce), and
// `vote_final_submit` matched it with ON CONFLICT on the same triple. Because
// the nonce is part of the key, a voter who resubmits with a fresh nonce
// inserts a *second row* rather than revising the first, and view_final_tally
// counts both. Anyone able to call /rpc/vote.final could inflate a result by
// looping with new nonces.
//
// `vote_submit` also rejects a round that is not published and enforces the
// vote window; `vote_final_submit` checked participation only, so a final vote
// was accepted in any phase — before the debate was published, or long after.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';

const describeDb = process.env.DB8_TEST_PG ? describe : describe.skip;

describeDb('final vote integrity', () => {
  let pool;
  const roomId = '4f1a0000-0000-0000-0000-000000000001';
  const roundId = '4f1a0000-0000-0000-0000-000000000002';
  const voterId = '4f1a0000-0000-0000-0000-000000000003';
  const otherId = '4f1a0000-0000-0000-0000-000000000004';

  const setPhase = (phase) =>
    pool.query('update rounds set phase = $2 where id = $1', [roundId, phase]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.query('insert into rooms(id, title) values ($1,$2)', [roomId, 'Final Vote Room']);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, published_at_unix) values ($1,$2,0,'final',extract(epoch from now())::bigint)",
      [roundId, roomId]
    );
    await pool.query(
      'insert into participants(id, room_id, anon_name, role) values ($1,$2,$3,$4), ($5,$2,$6,$7)',
      [voterId, roomId, 'final_voter', 'debater', otherId, 'final_other', 'debater']
    );
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.end();
  });

  const castVote = (approval, nonce, voter = voterId) =>
    pool.query('select vote_final_submit($1::uuid,$2::uuid,$3::boolean,$4::jsonb,$5::text) as id', [
      roundId,
      voter,
      approval,
      JSON.stringify([]),
      nonce
    ]);

  it('records one ballot per voter however many nonces they use', async () => {
    await setPhase('final');
    await castVote(true, 'nonce-a');
    await castVote(true, 'nonce-b');
    await castVote(true, 'nonce-c');

    const { rows } = await pool.query(
      'select count(*)::int as n from final_votes where round_id = $1 and voter_id = $2',
      [roundId, voterId]
    );
    expect(rows[0].n, 'three submissions from one voter must be one ballot').toBe(1);
  });

  it('lets a voter revise their ballot rather than adding another', async () => {
    await setPhase('final');
    await castVote(true, 'nonce-first');
    await castVote(false, 'nonce-second');

    const { rows } = await pool.query(
      'select approval from final_votes where round_id = $1 and voter_id = $2',
      [roundId, voterId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].approval, 'the later ballot is the one that stands').toBe(false);
  });

  it('does not inflate the tally when one voter resubmits', async () => {
    await setPhase('final');
    await castVote(true, 'tally-1');
    await castVote(true, 'tally-2');
    await castVote(false, 'tally-3', otherId);

    const { rows } = await pool.query('select * from view_final_tally where round_id = $1', [
      roundId
    ]);
    expect(Number(rows[0].approves) + Number(rows[0].rejects), 'two voters, two ballots').toBe(2);
  });

  it('refuses a final vote before the round reaches its voting phase', async () => {
    await setPhase('submit');
    await expect(castVote(true, 'too-early')).rejects.toThrow(/phase|not_final|window/i);
  });
});
