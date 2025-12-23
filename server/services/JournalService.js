import { buildJournalCore, finalizeJournal } from '../journal.js';
import { log } from '../utils.js';

/**
 * JournalService handles the creation and persistence of cryptographic journals.
 */
export class JournalService {
  constructor({ pool, signer }) {
    this.pool = pool;
    this.signer = signer;
  }

  /**
   * getUnsignedRounds fetches rounds that are published but haven't been journaled yet.
   */
  async getUnsignedRounds() {
    const { rows } = await this.pool.query('SELECT * FROM view_unsigned_published_rounds');
    return rows;
  }

  /**
   * createCheckpoint signs and persists a journal entry for a specific round.
   */
  async createCheckpoint(row) {
    try {
      // Look up previous journal hash for chain linking
      const prev = await this.pool
        .query('SELECT hash FROM journals WHERE room_id = $1 AND round_idx = $2', [
          row.room_id,
          Number(row.idx || 0) - 1
        ])
        .then((r) => (r.rows?.[0]?.hash ? String(r.rows[0].hash) : null))
        .catch(() => null);

      // Fetch transcript hashes for the round
      const sub = await this.pool.query(
        `SELECT canonical_sha256 FROM submissions_view WHERE round_id = $1 ORDER BY submitted_at ASC NULLS LAST, id ASC`,
        [row.round_id]
      );
      const hashes = sub.rows.map((r) => String(r.canonical_sha256));

      const core = buildJournalCore({
        room_id: row.room_id,
        round_id: row.round_id,
        idx: Number(row.idx || 0),
        phase: row.phase,
        submit_deadline_unix: row.submit_deadline_unix,
        published_at_unix: row.published_at_unix,
        continue_vote_close_unix: row.continue_vote_close_unix,
        continue_tally: { yes: Number(row.yes || 0), no: Number(row.no || 0) },
        transcript_hashes: hashes,
        prev_hash: prev
      });

      const journal = finalizeJournal({ core, signer: this.signer });

      await this.pool.query(
        'SELECT journal_upsert($1::uuid,$2::int,$3::text,$4::jsonb,$5::jsonb)',
        [row.room_id, Number(row.idx || 0), journal.hash, journal.signature, journal.core]
      );

      log.info('journal checkpoint created', {
        room_id: row.room_id,
        idx: row.idx,
        hash: journal.hash
      });
      return journal;
    } catch (err) {
      log.error('failed to create journal checkpoint', {
        room_id: row.room_id,
        idx: row.idx,
        error: err.message
      });
      throw err;
    }
  }

  /**
   * signUnsignedRounds processes all pending unsigned rounds.
   */
  async signUnsignedRounds() {
    const rows = await this.getUnsignedRounds();
    for (const row of rows) {
      await this.createCheckpoint(row);
    }
  }
}
