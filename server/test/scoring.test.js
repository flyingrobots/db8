import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app, { __setDbPool } from '../rpc.js';
import pg from 'pg';

// Rubric scoring and the Elo reputation derived from it.
//
// These tests used to be a single script: the first submitted a score, the
// second read the aggregate that the first had produced, the third depended on
// both, and the fourth on the third's reputation update. Nothing said so, and
// nothing enforced it -- they simply always ran in declaration order.
//
// Worse, they only passed at all because the shared test database still held
// rows from previous runs: dropping the two fixture rooms and running the file
// on its own failed with `composite_score` undefined and a foreign key
// violation. The suite was reading residue, which is not a fixture (E9, E11).
//
// Each test now arranges the whole scene it needs and asserts an effect rather
// than a status code.
describe('rubric scoring and the reputation it feeds', () => {
  let pool;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  const roomId = '99990000-0000-0000-0000-000000000001';
  const roundId = '99990000-0000-0000-0000-000000000002';
  const judgeId = '99990000-0000-0000-0000-000000000003';
  const debaterId = '99990000-0000-0000-0000-000000000004';
  const opponentId = '99990000-0000-0000-0000-000000000005';
  const taggedRoomId = '99990000-0000-0000-0000-000000000010';
  const rooms = [roomId, taggedRoomId];

  // The strong debater scores 80 on average, the weak one 50, so the direction
  // of the rating change is a fact about the system rather than a coin toss.
  const STRONG = { e: 80, r: 75, c: 90, v: 70, y: 85 };
  const WEAK = { e: 50, r: 50, c: 50, v: 50, y: 50 };
  const DEFAULT_ELO = 1200;

  // Everything below cascades from rooms: rounds, participants, scores,
  // reputation and reputation_tag all carry ON DELETE CASCADE, so dropping the
  // two rooms is a complete reset.
  const seed = async () => {
    await pool.query('delete from rooms where id = any($1)', [rooms]);
    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Scoring Room']);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'published')",
      [roundId, roomId]
    );
    await pool.query(
      `insert into participants(id, room_id, anon_name, role) values
         ($1, $4, 'judge_1', 'judge'),
         ($2, $4, 'debater_1', 'debater'),
         ($3, $4, 'opponent_1', 'debater')`,
      [judgeId, debaterId, opponentId, roomId]
    );
  };

  const submitScore = (participantId, rubric, nonce) =>
    supertest(app)
      .post('/rpc/score.submit')
      .send({
        round_id: roundId,
        judge_id: judgeId,
        participant_id: participantId,
        ...rubric,
        client_nonce: nonce
      });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    __setDbPool(pool);
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = any($1)', [rooms]);
    await pool.end();
  });

  it('stores the rubric values it was given, not merely a 200', async () => {
    await seed();

    const res = await submitScore(debaterId, STRONG, 'score-nonce-record');
    expect(res.status, `score.submit -> ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.ok).toBe(true);

    // The status said the request was accepted. This says the five rubric
    // values reached the table, which is what "record" means.
    const rows = await pool.query(
      'select e, r, c, v, y from scores where round_id = $1 and participant_id = $2',
      [roundId, debaterId]
    );
    expect(rows.rows, 'one score row for the debater').toHaveLength(1);
    expect(rows.rows[0]).toMatchObject(STRONG);
  });

  it('aggregates a submitted score into a composite for the round', async () => {
    await seed();
    await submitScore(debaterId, STRONG, 'score-nonce-aggregate');

    const res = await supertest(app).get('/rpc/scores.get').query({ round_id: roundId });

    expect(res.status).toBe(200);
    const mine = (res.body.rows ?? []).filter((row) => row.participant_id === debaterId);
    expect(mine, `aggregate rows for the debater in ${JSON.stringify(res.body.rows)}`).toHaveLength(
      1
    );
    expect(mine[0].composite_score).toBeGreaterThan(0);
  });

  it('raises the better-scored debater above the default rating', async () => {
    await seed();
    await submitScore(debaterId, STRONG, 'score-nonce-strong');
    await submitScore(opponentId, WEAK, 'score-nonce-weak');

    const updated = await supertest(app).post('/rpc/reputation.update').send({ room_id: roomId });
    expect(updated.status, `reputation.update -> ${JSON.stringify(updated.body)}`).toBe(200);

    const strong = await supertest(app)
      .get('/rpc/reputation.get')
      .query({ participant_id: debaterId });
    const weak = await supertest(app)
      .get('/rpc/reputation.get')
      .query({ participant_id: opponentId });

    // "not 1200" would pass on any perturbation, in either direction. The
    // promise is that scoring better raises your rating and scoring worse
    // lowers it, so assert the direction and the ordering.
    expect(strong.body.elo, 'the 80-average debater gains rating').toBeGreaterThan(DEFAULT_ELO);
    expect(weak.body.elo, 'the 50-average debater loses rating').toBeLessThan(DEFAULT_ELO);
    expect(strong.body.elo).toBeGreaterThan(weak.body.elo);
  });

  it('reports a per-tag rating for a participant', async () => {
    await seed();
    await pool.query(
      'insert into rooms(id, title, config) values ($1, $2, \'{"tags": ["science"]}\')',
      [taggedRoomId, 'Tag Room']
    );

    const res = await supertest(app)
      .get('/rpc/reputation.get')
      .query({ participant_id: debaterId, tag: 'science' });

    expect(res.status).toBe(200);
    expect(res.body.tag).toBe('science');
    expect(typeof res.body.elo, `elo was ${JSON.stringify(res.body.elo)}`).toBe('number');
  });
});
