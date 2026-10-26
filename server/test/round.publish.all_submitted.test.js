import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';

// #229: a round publishes as soon as every debater in its room has submitted,
// instead of always waiting for the deadline. The deadline rule is unchanged.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';

const describeDb = process.env.DB8_TEST_PG ? describe : describe.skip;

describeDb('round_publish_due publishes when every debater has submitted', () => {
  let pool;
  const id = (n) => `22900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const far = () => Math.floor(Date.now() / 1000) + 3600;

  // Room n: debaters id(n*10+1..+4), a judge id(n*10+9), round id(n*10).
  async function seedRoom(n, { debaters = 4, deadline = far() } = {}) {
    const room = id(n * 100);
    const round = id(n * 100 + 50);
    await pool.query('delete from rooms where id = $1', [room]);
    await pool.query('insert into rooms(id, title) values ($1, $2)', [room, `publish-${n}`]);
    await pool.query(
      "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, 'submit', $3)",
      [round, room, deadline]
    );
    const seats = [];
    for (let i = 1; i <= debaters; i++) {
      seats.push(id(n * 100 + i));
      await pool.query(
        "insert into participants(id, room_id, anon_name, role) values ($1, $2, $3, 'debater')",
        [id(n * 100 + i), room, `agent_${i}`]
      );
    }
    await pool.query(
      "insert into participants(id, room_id, anon_name, role) values ($1, $2, 'judge_1', 'judge')",
      [id(n * 100 + 99), room]
    );
    return { room, round, seats };
  }

  const submit = (round, author, nonce) =>
    pool.query(
      'select submission_upsert($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::text,$7::text)',
      [
        round,
        author,
        `turn by ${author}`,
        '[]',
        '[]',
        crypto.createHash('sha256').update(nonce).digest('hex'),
        `pub-${nonce}`
      ]
    );
  const phaseOf = async (round) =>
    (await pool.query('select phase from rounds where id = $1', [round])).rows[0].phase;
  const publishReason = async (round) =>
    (
      await pool.query(
        "select details->>'reason' as reason from admin_audit_log where entity_id = $1 and action = 'publish'",
        [round]
      )
    ).rows.map((r) => r.reason);

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: dbUrl });
  });

  afterAll(async () => {
    for (const n of [1, 2, 3, 4])
      await pool.query('delete from rooms where id = $1', [id(n * 100)]);
    await pool.end();
  });

  it('3 of 4 debaters submitted: still submit; the 4th plus a sweep: published early', async () => {
    const { round, seats } = await seedRoom(1);
    for (const [i, s] of seats.slice(0, 3).entries()) await submit(round, s, `r1-${i}`);
    await pool.query('select round_publish_due()');
    expect(await phaseOf(round)).toBe('submit');

    await submit(round, seats[3], 'r1-3');
    await pool.query('select round_publish_due()');
    expect(await phaseOf(round)).toBe('published');
    const row = (
      await pool.query(
        'select published_at_unix, continue_vote_close_unix, submit_deadline_unix from rounds where id = $1',
        [round]
      )
    ).rows[0];
    expect(Number(row.published_at_unix)).toBeLessThan(Number(row.submit_deadline_unix));
    expect(Number(row.continue_vote_close_unix)).toBeGreaterThan(Number(row.published_at_unix));
    expect(await publishReason(round)).toEqual(['all_submitted']);
  });

  it('the deadline still publishes a round with missing submissions', async () => {
    const { round, seats } = await seedRoom(2, { deadline: 100 });
    await submit(round, seats[0], 'r2-0');
    await pool.query('select round_publish_due()');
    expect(await phaseOf(round)).toBe('published');
    expect(await publishReason(round)).toEqual(['deadline']);
  });

  it('a room with no debaters does not publish before its deadline', async () => {
    const { round } = await seedRoom(3, { debaters: 0 });
    await pool.query('select round_publish_due()');
    expect(await phaseOf(round)).toBe('submit');
  });

  it("a judge's missing submission does not hold the round", async () => {
    const { round, seats } = await seedRoom(4, { debaters: 2 });
    for (const [i, s] of seats.entries()) await submit(round, s, `r4-${i}`);
    await pool.query('select round_publish_due()');
    expect(await phaseOf(round)).toBe('published');
  });
});
