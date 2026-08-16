import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// One judge, one score per participant per round.
//
// This is the `final_votes` ballot-stuffing bug, unfixed in the scoring path.
// `final_votes` was changed to UNIQUE (round_id, voter_id) with this comment at
// db/schema.sql:112-114:
//
//   "The nonce is deliberately NOT part of this key: with it, a voter
//    resubmitting under a fresh nonce inserted a second row and
//    view_final_tally counted both."
//
// `scores` still carries UNIQUE (round_id, judge_id, participant_id,
// client_nonce) and `score_submit` conflict-targets that same 4-tuple, while
// `view_score_aggregates` does AVG(...) and COUNT(judge_id) over every row. So a
// judge revising a score under a fresh nonce inflates both the average and the
// judge count. The reasoning was written down for votes and never carried over.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';

const describeDb = process.env.DB8_TEST_PG === '1' ? describe : describe.skip;

describeDb('one judge, one score per participant per round', () => {
  let pool;

  const roomId = '9c0e0000-0000-0000-0000-000000000001';
  const roundId = '9c0e0000-0000-0000-0000-000000000002';
  const judgeId = '9c0e0000-0000-0000-0000-000000000003';
  const otherJudgeId = '9c0e0000-0000-0000-0000-000000000005';

  // A debater per test. The bug is about one judge scoring one participant
  // repeatedly, so the judge is deliberately shared — but the *subject* must not
  // be, or each test's row counts include every earlier test's rows and the
  // suite only passes in declaration order (E11).
  const DEBATERS = {
    manyNonces: '9c0e0000-0000-0000-0000-000000000010',
    revises: '9c0e0000-0000-0000-0000-000000000011',
    aggregate: '9c0e0000-0000-0000-0000-000000000012',
    twoJudges: '9c0e0000-0000-0000-0000-000000000013'
  };

  const score = (debater, rubric, nonce, judge = judgeId) =>
    pool.query(
      'select score_submit($1::uuid,$2::uuid,$3::uuid,$4::int,$5::int,$6::int,$7::int,$8::int,$9::text) as id',
      [roundId, judge, debater, rubric.e, rubric.r, rubric.c, rubric.v, rubric.y, nonce]
    );

  const rowsFor = async (debater) =>
    (
      await pool.query(
        'select count(*)::int as n from scores where round_id = $1 and judge_id = $2 and participant_id = $3',
        [roundId, judgeId, debater]
      )
    ).rows[0].n;

  const aggregate = async (debater) =>
    (
      await pool.query(
        'select avg_e, composite_score, judge_count from view_score_aggregates where round_id = $1 and participant_id = $2',
        [roundId, debater]
      )
    ).rows[0];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.query('insert into rooms(id, title) values ($1,$2)', [
      roomId,
      'Score Revision Room'
    ]);
    await pool.query("insert into rounds(id, room_id, idx, phase) values ($1,$2,0,'published')", [
      roundId,
      roomId
    ]);
    await pool.query(
      `insert into participants(id, room_id, anon_name, role) values
         ($1,$3,'rev_judge','judge'),
         ($2,$3,'rev_judge_2','judge')`,
      [judgeId, otherJudgeId, roomId]
    );
    for (const [name, id] of Object.entries(DEBATERS)) {
      await pool.query(
        'insert into participants(id, room_id, anon_name, role) values ($1,$2,$3,$4)',
        [id, roomId, `rev_${name}`, 'debater']
      );
    }
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.end();
  });

  it('records one score however many nonces a judge submits under', async () => {
    const d = DEBATERS.manyNonces;
    await score(d, { e: 10, r: 10, c: 10, v: 10, y: 10 }, 'rev-nonce-a');
    await score(d, { e: 20, r: 20, c: 20, v: 20, y: 20 }, 'rev-nonce-b');
    await score(d, { e: 30, r: 30, c: 30, v: 30, y: 30 }, 'rev-nonce-c');

    expect(await rowsFor(d), 'three submissions from one judge is one score').toBe(1);
  });

  it('lets a judge revise a score rather than adding another', async () => {
    const d = DEBATERS.revises;
    await score(d, { e: 40, r: 40, c: 40, v: 40, y: 40 }, 'rev-first');
    await score(d, { e: 90, r: 90, c: 90, v: 90, y: 90 }, 'rev-second');

    const rows = await pool.query(
      'select e from scores where round_id = $1 and judge_id = $2 and participant_id = $3',
      [roundId, judgeId, d]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].e, 'the later score is the one that stands').toBe(90);
  });

  it('does not inflate the aggregate or the judge count when a judge revises', async () => {
    // A judge scoring 100 then correcting to 50 must not average to 75, and must
    // not look like two judges.
    const d = DEBATERS.aggregate;
    await score(d, { e: 100, r: 100, c: 100, v: 100, y: 100 }, 'infl-1');
    await score(d, { e: 50, r: 50, c: 50, v: 50, y: 50 }, 'infl-2');

    const agg = await aggregate(d);
    expect(Number(agg.judge_count), 'one judge scored, however many times').toBe(1);
    expect(Number(agg.avg_e), 'the average is the revised score, not the mean of both').toBe(50);
    expect(Number(agg.composite_score)).toBe(50);
  });

  it('still counts two different judges as two', async () => {
    // The control: collapsing revisions must not collapse distinct judges.
    const d = DEBATERS.twoJudges;
    await score(d, { e: 60, r: 60, c: 60, v: 60, y: 60 }, 'two-judges-a');
    await score(d, { e: 80, r: 80, c: 80, v: 80, y: 80 }, 'two-judges-b', otherJudgeId);

    const agg = await aggregate(d);
    expect(Number(agg.judge_count), 'two distinct judges').toBe(2);
    expect(Number(agg.avg_e), 'the mean of two judges, not of four rows').toBe(70);
  });
});
