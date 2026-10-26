import crypto from 'node:crypto';

/**
 * VoteService handles continue and final approval voting.
 */
export class VoteService {
  constructor({ dbRef, memVotes, memVoteTotals, memFinalVotes = new Map() }) {
    this.dbRef = dbRef;
    this.memVotes = memVotes;
    this.memVoteTotals = memVoteTotals;
    this.memFinalVotes = memFinalVotes;
  }

  get pool() {
    return this.dbRef.pool;
  }

  async castContinueVote({ round_id, voter_id, choice, client_nonce, room_id }) {
    // Keyed on the voter, not the nonce, like the database (#227): a later
    // ballot replaces the earlier one in the tally instead of adding to it.
    const key = `${round_id}:${voter_id}:continue`;
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

    // The ballots live inside the tally they were counted in. rpc.js bounds
    // ballots and tallies in separate caches; kept apart, a tally evicted while
    // its ballot survived made a revision subtract from a fresh zero tally and
    // drive a count negative. Together they are evicted together. The field is
    // non-enumerable, so /state still serializes the tally as { yes, no }.
    const t = this.memVoteTotals.get(room_id) || { yes: 0, no: 0 };
    if (!(t.ballots instanceof Map)) {
      Object.defineProperty(t, 'ballots', { value: new Map(), enumerable: false });
    }
    const previous = t.ballots.get(key);
    // The same choice again changes nothing; a different one revises the
    // ballot, as vote_submit does.
    if (previous && previous.choice === choice) return { vote_id: previous.id, note };
    if (previous) {
      if (previous.choice === 'continue') t.yes -= 1;
      else t.no -= 1;
    }
    const vote_id = previous?.id ?? crypto.randomUUID();
    t.ballots.set(key, { id: vote_id, choice });
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
      return { ...this._finalInMemory(round_id, voter_id, approval, ranking), note: 'db_fallback' };
    }
    return {
      ...this._finalInMemory(round_id, voter_id, approval, ranking),
      note: this.dbRef.configured ? 'db_fallback' : undefined
    };
  }

  // One ballot per voter per round, revised in place, as final_votes is keyed.
  // Acknowledging a final vote without keeping it told the caller a discarded
  // ballot had counted.
  _finalInMemory(round_id, voter_id, approval, ranking) {
    const key = `${round_id}:${voter_id}`;
    const vote_id = this.memFinalVotes.get(key)?.id ?? crypto.randomUUID();
    this.memFinalVotes.set(key, { id: vote_id, round_id, approval, ranking: ranking || [] });
    return { vote_id };
  }
}
