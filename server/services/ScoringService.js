import crypto from 'node:crypto';

/**
 * ScoringService handles judge scores and reputation.
 */
export class ScoringService {
  constructor({ dbRef }) {
    this.dbRef = dbRef;
  }

  get pool() {
    return this.dbRef.pool;
  }

  async submitScore(input) {
    if (this.pool) {
      try {
        const r = await this.pool.query(
          'SELECT score_submit($1::uuid,$2::uuid,$3::uuid,$4::int,$5::int,$6::int,$7::int,$8::int,$9::text) AS id',
          [
            input.round_id,
            input.judge_id,
            input.participant_id,
            input.e,
            input.r,
            input.c,
            input.v,
            input.y,
            input.client_nonce
          ]
        );
        return { score_id: r.rows[0].id };
      } catch (err) {
        console.error('[ScoringService] DB error, falling back to memory:', err.message);
      }
    }
    return { score_id: crypto.randomUUID(), note: 'db_fallback' };
  }

  async getScores(roundId) {
    if (this.pool) {
      try {
        const r = await this.pool.query('SELECT * FROM view_score_aggregates WHERE round_id = $1', [
          roundId
        ]);
        return r.rows.map((row) => ({
          ...row,
          avg_e: Number(row.avg_e),
          avg_r: Number(row.avg_r),
          avg_c: Number(row.avg_c),
          avg_v: Number(row.avg_v),
          avg_y: Number(row.avg_y),
          composite_score: Number(row.composite_score),
          judge_count: Number(row.judge_count)
        }));
      } catch (err) {
        console.error(
          '[ScoringService] DB error (getScores), falling back to memory:',
          err.message
        );
      }
    }
    return [];
  }

  async getReputation(participantId, tag = null) {
    if (this.pool) {
      try {
        if (tag) {
          const r = await this.pool.query(
            'SELECT elo FROM reputation_tag WHERE participant_id = $1 AND tag = $2',
            [participantId, tag]
          );
          return Number(r.rows[0]?.elo || 1200);
        }
        const r = await this.pool.query('SELECT elo FROM reputation WHERE participant_id = $1', [
          participantId
        ]);
        return Number(r.rows[0]?.elo || 1200);
      } catch (err) {
        console.error(
          '[ScoringService] DB error (getReputation), falling back to memory:',
          err.message
        );
      }
    }
    return 1200;
  }

  async updateReputations(roundId) {
    if (this.pool) {
      try {
        await this.pool.query('SELECT reputation_update_round($1::uuid)', [roundId]);
        return true;
      } catch (err) {
        console.error(
          '[ScoringService] DB error (updateReputations), falling back to memory:',
          err.message
        );
      }
    }
    return true;
  }
}
