import crypto from 'node:crypto';
import { queryOrUnavailable } from '../database-unavailable.js';

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
    // A configured database is the only place a vote counts (#257). A rule
    // vote_submit enforced (wrong phase, closed window) is rethrown as is; an
    // outage is a DatabaseUnavailableError, and nothing is kept in memory.
    if (this.pool) {
      const r = await queryOrUnavailable(
        this.pool,
        'SELECT vote_submit($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text) AS id',
        [round_id, voter_id, 'continue', JSON.stringify({ choice }), client_nonce]
      );
      if (!r.rows[0]?.id) throw new Error('vote_submit returned no id');
      return { vote_id: r.rows[0].id };
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
    if (previous && previous.choice === choice) return { vote_id: previous.id };
    if (previous) {
      if (previous.choice === 'continue') t.yes -= 1;
      else t.no -= 1;
    }
    const vote_id = previous?.id ?? crypto.randomUUID();
    t.ballots.set(key, { id: vote_id, choice });
    if (choice === 'continue') t.yes += 1;
    else t.no += 1;
    this.memVoteTotals.set(room_id, t);

    return { vote_id };
  }

  async castFinalVote({ round_id, voter_id, approval, ranking, client_nonce }) {
    if (this.pool) {
      // vote_final_submit raises for a non-final phase and for a
      // non-participant; those are rethrown as is. An outage is a
      // DatabaseUnavailableError (#257).
      const r = await queryOrUnavailable(
        this.pool,
        'SELECT vote_final_submit($1::uuid,$2::uuid,$3::boolean,$4::jsonb,$5::text) AS id',
        [round_id, voter_id, approval, JSON.stringify(ranking || []), client_nonce]
      );
      return { vote_id: r.rows[0].id };
    }
    return this._finalInMemory(round_id, voter_id, approval, ranking);
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
