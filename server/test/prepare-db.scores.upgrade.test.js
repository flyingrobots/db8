import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// scripts/prepare-db.js against a database with the legacy scores key and two
// tied, differing revisions. The upgrade refuses to guess
// (scores_upgrade_ambiguous), and the operator deletes the losing revision.
// Its nonce must already be recorded, or a delayed retry of it overwrites the
// kept score. So the nonce backfill commits before the upgrade can refuse.

const dbUrl =
  process.env.DB8_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:test@localhost:54329/db8_test';
const describeDb = process.env.DB8_TEST_PG ? describe : describe.skip;
const prepareDb = fileURLToPath(new URL('../../scripts/prepare-db.js', import.meta.url));

const ids = {
  room: '21900000-0000-4000-8000-000000000301',
  round: '21900000-0000-4000-8000-000000000302',
  debater: '21900000-0000-4000-8000-000000000311',
  judge: '21900000-0000-4000-8000-000000000319'
};

describeDb('prepare-db: an ambiguous scores upgrade keeps the nonces it found', () => {
  it('records both nonces, then upgrades once the operator chose', async () => {
    // Its own database: prepare-db takes schema-wide locks that sibling suites
    // must not run into.
    const name = `db8_scores_upgrade_${process.pid}_${Date.now()}`;
    const url = new URL(dbUrl);
    url.pathname = `/${name}`;
    const prepare = () =>
      spawnSync(process.execPath, [prepareDb], {
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
        timeout: 60_000
      });
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const db = new pg.Client({ connectionString: url.toString() });
    try {
      expect(prepare().status, 'a fresh database prepares').toBe(0);
      await db.connect();
      // Put the database back in its legacy shape: no score_nonces, and the
      // nonce in the scores key.
      await db.query('drop table score_nonces');
      await db.query(
        'alter table scores drop constraint scores_round_id_judge_id_participant_id_key'
      );
      await db.query(
        'alter table scores add constraint scores_round_id_judge_id_participant_id_client_nonce_key unique (round_id, judge_id, participant_id, client_nonce)'
      );
      await db.query('insert into rooms(id, title) values ($1, $2)', [ids.room, 'upgrade']);
      await db.query(
        "insert into rounds(id, room_id, idx, phase, submit_deadline_unix) values ($1, $2, 0, 'published', 0)",
        [ids.round, ids.room]
      );
      await db.query(
        "insert into participants(id, room_id, anon_name, role) values ($1, $3, 'd', 'debater'), ($2, $3, 'j', 'judge')",
        [ids.debater, ids.judge, ids.room]
      );
      // One statement, so both rows share now(): neither is the latest.
      await db.query(
        `insert into scores (round_id, judge_id, participant_id, e, r, c, v, y, client_nonce) values
           ($1, $2, $3, 20, 20, 20, 20, 20, 'tie-a'),
           ($1, $2, $3, 80, 80, 80, 80, 80, 'tie-b')`,
        [ids.round, ids.judge, ids.debater]
      );

      const refused = prepare();
      expect(refused.status, 'the ambiguous upgrade is refused').toBe(1);
      expect(refused.stderr).toMatch(/scores_upgrade_ambiguous/);
      const recorded = await db.query(
        'select client_nonce from score_nonces where participant_id = $1 order by client_nonce',
        [ids.debater]
      );
      expect(
        recorded.rows.map((r) => r.client_nonce),
        'both nonces are recorded although the upgrade was refused'
      ).toEqual(['tie-a', 'tie-b']);

      // The operator keeps the 80.
      await db.query("delete from scores where client_nonce = 'tie-a'");
      expect(prepare().status, 'the upgrade runs once nothing is ambiguous').toBe(0);

      const retry = await db.query(
        "select score_submit($1, $2, $3, 20, 20, 20, 20, 20, 'tie-a') as id",
        [ids.round, ids.judge, ids.debater]
      );
      const kept = await db.query('select id, e from scores where participant_id = $1', [
        ids.debater
      ]);
      expect(kept.rows).toEqual([{ id: retry.rows[0].id, e: 80 }]);
    } finally {
      await db.end().catch(() => {});
      await admin.query(`drop database if exists ${name}`);
      await admin.end();
    }
  });
});
