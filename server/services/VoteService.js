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
    // `db_fallback` means "a configured database failed and this vote lives only
    // in memory". Memory mode by configuration is not a fallback, and clients
    // such as the MCP agent server treat the note as a failed write (#231).
    let note = this.dbRef.configured ? 'db_fallback' : undefined;
    if (this.pool) {
      try {
        const r = await this.pool.query(
          'SELECT vote_submit($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text) AS id',
          [round_id, voter_id, 'continue', JSON.stringify({ choice }), client_nonce]
        );
        if (r.rows[0]?.id) return { vote_id: r.rows[0].id };
      } catch (err) {
        // A rule vote_submit enforced (wrong phase, closed window) is not an
        // outage. Counting the ballot in memory anyway answered 200 to a vote
        // the database had refused. Same discrimination as castFinalVote.
        if (err?.severity) throw err;
        console.error('[VoteService] DB error, falling back to memory:', err.message);
      }
      note = 'db_fallback';
    }

    // A repeat of the same ballot key revises the choice, as vote_submit's
    // ON CONFLICT ... DO UPDATE SET ballot does. Returning early left the old
    // choice counted after a voter changed their mind.
    const t = this.memVoteTotals.get(room_id) || { yes: 0, no: 0 };
    const previous = this.memVotes.get(key);
    if (previous && previous.choice === choice) return { vote_id: previous.id, note };
    if (previous) {
      if (previous.choice === 'continue') t.yes = Math.max(0, t.yes - 1);
      else t.no = Math.max(0, t.no - 1);
    }
    const vote_id = previous?.id ?? crypto.randomUUID();
    this.memVotes.set(key, { id: vote_id, choice });
    if (choice === 'continue') t.yes += 1;
    else t.no += 1;
    this.memVoteTotals.set(room_id, t);

    return { vote_id, note };
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
      return { vote_id: crypto.randomUUID(), note: 'db_fallback' };
    }
    return {
      vote_id: crypto.randomUUID(),
      note: this.dbRef.configured ? 'db_fallback' : undefined
    };
  }
}
