import crypto from 'node:crypto';

/**
 * VoteService handles continue and final approval voting.
 */
export class VoteService {
  constructor({ dbRef, memVotes, memVoteTotals }) {
    this.dbRef = dbRef;
    this.memVotes = memVotes;
    this.memVoteTotals = memVoteTotals;
  }

  get pool() {
    return this.dbRef.pool;
  }

  async castContinueVote({ round_id, voter_id, choice, client_nonce, room_id }) {
    const key = `${round_id}:${voter_id}:continue:${client_nonce}`;
    if (this.pool) {
      try {
        const r = await this.pool.query(
          'SELECT vote_submit($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text) AS id',
          [round_id, voter_id, 'continue', JSON.stringify({ choice }), client_nonce]
        );
        if (r.rows[0]?.id) return { vote_id: r.rows[0].id };
      } catch (err) {
        console.error('[VoteService] DB error, falling back to memory:', err.message);
      }
    }

    if (this.memVotes.has(key)) return { vote_id: this.memVotes.get(key).id, note: 'db_fallback' };
    const vote_id = crypto.randomUUID();
    this.memVotes.set(key, { id: vote_id, choice });

    const t = this.memVoteTotals.get(room_id) || { yes: 0, no: 0 };
    if (choice === 'continue') t.yes += 1;
    else t.no += 1;
    this.memVoteTotals.set(room_id, t);

    return { vote_id, note: 'db_fallback' };
  }

  async castFinalVote({ round_id, voter_id, approval, ranking, client_nonce }) {
    if (this.pool) {
      try {
        const r = await this.pool.query(
          'SELECT vote_final_submit($1::uuid,$2::uuid,$3::boolean,$4::jsonb,$5::text) AS id',
          [round_id, voter_id, approval, JSON.stringify(ranking || []), client_nonce]
        );
        return { vote_id: r.rows[0].id };
      } catch (err) {
        // A rule the database enforced is not an outage. vote_final_submit
        // raises for a non-final phase and for a non-participant; swallowing
        // those returned a fabricated vote_id with HTTP 200 and told the caller
        // an invalid, unpersisted ballot had been accepted.
        //
        // Postgres sets `severity` on anything it replied with; a connection
        // that never got an answer has none. Same discrimination as
        // PostgresVerdictStore.
        if (err?.severity) throw err;
        console.error('[VoteService] database unreachable (final_vote):', err.message);
      }
    }
    return { vote_id: crypto.randomUUID(), note: 'db_fallback' };
  }
}
