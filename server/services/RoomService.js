import crypto from 'node:crypto';

/**
 * RoomService handles room lifecycle, state aggregation, and in-memory fallback management.
 */
export class RoomService {
  constructor({ dbRef, memRooms, memRoomNonces, memSubmissions, memFlags, memVoteTotals, config }) {
    this.dbRef = dbRef;
    this.memRooms = memRooms;
    this.memRoomNonces = memRoomNonces;
    this.memSubmissions = memSubmissions;
    this.memFlags = memFlags;
    this.memVoteTotals = memVoteTotals;
    this.config = config;
  }

  get pool() {
    return this.dbRef.pool;
  }

  /**
   * getRoomState aggregates room data from DB or memory.
   */
  async getRoomState(roomId) {
    if (this.pool) {
      try {
        const roomRes = await this.pool
          .query('SELECT * FROM view_current_round WHERE room_id = $1 ORDER BY idx DESC LIMIT 1', [
            roomId
          ])
          .catch((e) => {
            throw new Error(`view_current_round: ${e.message}`);
          });
        const tallyRes = await this.pool
          .query('SELECT * FROM view_continue_tally WHERE room_id = $1', [roomId])
          .catch((e) => {
            throw new Error(`view_continue_tally: ${e.message}`);
          });
        const finalTallyRes = await this.pool
          .query('SELECT approves, rejects FROM view_final_tally WHERE room_id = $1', [roomId])
          .catch((e) => {
            throw new Error(`view_final_tally: ${e.message}`);
          });
        const submissionsRes = await this.pool
          .query(
            `select id,
                    author_id,
                    author_anon_name,
                    content,
                    canonical_sha256,
                    submitted_at,
                    flag_count,
                    flag_details
               from submissions_with_flags_view
              where room_id = $1
              order by idx asc, submitted_at asc nulls last, id asc`,
            [roomId]
          )
          .catch((e) => {
            throw new Error(`submissions_with_flags_view: ${e.message}`);
          });
        const verifyRes = await this.pool
          .query('SELECT * FROM verification_verdicts_view WHERE room_id = $1', [roomId])
          .catch((e) => {
            throw new Error(`verification_verdicts_view: ${e.message}`);
          });

        const roundRow = roomRes.rows[0];
        if (roundRow) {
          const tallyRow = tallyRes.rows.find((r) => r.round_id === roundRow.round_id) || {};
          const finalTallyRow = finalTallyRes.rows[0] || {};

          const transcript = submissionsRes.rows.map((row) => ({
            submission_id: row.id,
            author_id: row.author_id,
            author_anon_name: row.author_anon_name,
            content: row.content,
            canonical_sha256: row.canonical_sha256,
            submitted_at: row.submitted_at,
            flag_count: Number(row.flag_count || 0),
            flags: Array.isArray(row.flag_details) ? row.flag_details : []
          }));

          const flagged = transcript
            .filter((s) => s.flag_count > 0)
            .map((s) => ({ submission_id: s.submission_id, flag_count: s.flag_count }));

          return {
            ok: true,
            room_id: roomId,
            round: {
              round_id: roundRow.round_id,
              idx: roundRow.idx,
              phase: roundRow.phase,
              submit_deadline_unix: roundRow.submit_deadline_unix,
              published_at_unix: roundRow.published_at_unix,
              continue_vote_close_unix: roundRow.continue_vote_close_unix,
              continue_tally: { yes: Number(tallyRow.yes || 0), no: Number(tallyRow.no || 0) },
              final_tally: {
                approves: Number(finalTallyRow.approves || 0),
                rejects: Number(finalTallyRow.rejects || 0)
              },
              transcript,
              verifications: verifyRes.rows || []
            },
            flags: flagged
          };
        }
      } catch (err) {
        console.error('[RoomService] DB error, falling back to memory:', err.message);
      }
    }

    // Memory Fallback
    let room = this.memRooms.get(roomId);
    if (!room) {
      // In test/dev, we might want a default room if none was created
      const submitWindow = this.config?.submitWindowSec ?? 300;
      room = {
        topic: 'Default Room',
        round: {
          round_id: crypto.randomUUID(),
          idx: 0,
          phase: 'submit',
          submit_deadline_unix: Math.floor(Date.now() / 1000) + submitWindow
        }
      };
      this.memRooms.set(roomId, room);
    }

    // Dynamic phase calculation for memory path (authoritative timers)
    const now = Math.floor(Date.now() / 1000);
    if (
      room.round.phase === 'submit' &&
      room.round.submit_deadline_unix > 0 &&
      now > room.round.submit_deadline_unix
    ) {
      room.round.phase = 'published';
      room.round.published_at_unix = now;
      const continueWindow = this.config?.continueWindowSec ?? 30;
      room.round.continue_vote_close_unix = now + continueWindow;
    } else if (
      room.round.phase === 'published' &&
      room.round.continue_vote_close_unix > 0 &&
      now > room.round.continue_vote_close_unix
    ) {
      // Tally continue votes
      const tally = this.memVoteTotals.get(roomId) || { yes: 0, no: 0 };
      if (tally.yes > tally.no) {
        // The outgoing round has published; remember it so its submissions
        // stay visible after the room moves on.
        room.publishedRounds = new Set(room.publishedRounds).add(room.round.round_id);
        room.round = {
          round_id: crypto.randomUUID(),
          idx: room.round.idx + 1,
          phase: 'submit',
          submit_deadline_unix: now + 300
        };
        // Reset vote totals for the next round
        this.memVoteTotals.set(roomId, { yes: 0, no: 0 });
      } else {
        room.round.phase = 'final';
      }
    }

    const tally = this.memVoteTotals.get(roomId) || { yes: 0, no: 0 };
    // Blind submission (#226), failing closed: a submission is visible only if
    // its round is known to have published. That is a round this room has moved
    // past, or the current round once it is no longer in submit. A submission
    // naming any other round id, or a room whose round has no id, shows nothing.
    const published = new Set(room.publishedRounds);
    if (room.round.round_id && room.round.phase !== 'submit') published.add(room.round.round_id);
    const transcript = Array.from(this.memSubmissions.entries())
      .filter(([key, value]) => key.startsWith(`${roomId}:`) && published.has(value.round_id))
      .map(([, value]) => {
        const flags = this.memFlags.get(value.id);
        const count = flags ? flags.size : 0;
        return {
          submission_id: value.id,
          author_id: value.author_id,
          content: value.content,
          canonical_sha256: value.canonical_sha256,
          flag_count: count
        };
      });

    return {
      ok: true,
      room_id: roomId,
      round: { ...room.round, continue_tally: tally, transcript },
      flags: transcript
        .filter((s) => s.flag_count > 0)
        .map((s) => ({ submission_id: s.submission_id, flag_count: s.flag_count }))
    };
  }

  /**
   * getRoom returns a room's topic, status, config and seats, or null if the
   * room does not exist. Seats are ordered by seat number (agent_2 before
   * agent_10).
   */
  async getRoom(roomId) {
    let dbError = null;
    if (this.pool) {
      try {
        const roomRes = await this.pool.query(
          'SELECT id, title, status, config FROM rooms_view WHERE id = $1',
          [roomId]
        );
        const row = roomRes.rows[0];
        // No row is not proof the room is missing: one created in memory
        // during an outage lives only there, so check memory before saying so.
        if (!row) return this._memoryRoom(roomId);
        const seatsRes = await this.pool.query(
          `SELECT id, anon_name, role FROM participants_view
            WHERE room_id = $1
            ORDER BY length(anon_name), anon_name, id`,
          [roomId]
        );
        return {
          room_id: row.id,
          topic: row.title,
          status: row.status,
          config: row.config || {},
          participants: seatsRes.rows
        };
      } catch (err) {
        console.error('[RoomService] DB error (getRoom), falling back to memory:', err.message);
        dbError = err;
      }
    }

    const room = this._memoryRoom(roomId);
    // Memory holds only rooms created while the database was unavailable.
    // After a failed query, "not in memory" is not "does not exist": say so
    // rather than reporting a real room as missing.
    if (!room && dbError) throw new Error('database_unavailable', { cause: dbError });
    return room;
  }

  _memoryRoom(roomId) {
    // Rooms that getRoomState invents on the fly have no seats; they were never
    // created, so they are not reported here.
    const room = this.memRooms.get(roomId);
    if (!room?.participants) return null;
    return {
      room_id: roomId,
      topic: room.topic,
      status: room.status,
      config: room.config,
      participants: room.participants.map(({ id, anon_name, role }) => ({ id, anon_name, role }))
    };
  }

  /**
   * createRoom creates a new debate room.
   */
  async createRoom({ topic, cfg, client_nonce }) {
    if (this.pool) {
      try {
        const r = await this.pool.query('SELECT room_create($1,$2,$3) AS id', [
          topic,
          JSON.stringify(cfg || {}),
          client_nonce
        ]);
        return { room_id: r.rows[0].id };
      } catch (err) {
        console.error('[RoomService] DB error (createRoom), falling back to memory:', err.message);
      }
    }

    if (this.memRoomNonces.has(client_nonce)) {
      return { room_id: this.memRoomNonces.get(client_nonce) };
    }

    const roomId = crypto.randomUUID();
    // Seed seats the way room_create does (agent_1..agent_N, all debaters), so
    // memory mode can answer room.get with the same shape as the database.
    const seats = cfg?.participant_count ?? 4;
    this.memRooms.set(roomId, {
      topic,
      status: 'active',
      config: {},
      participants: Array.from({ length: seats }, (_, i) => ({
        id: crypto.randomUUID(),
        anon_name: `agent_${i + 1}`,
        role: 'debater'
      })),
      round: {
        // Without an id, /state could never name this round, and the blind
        // submission filter could never show its submissions.
        round_id: crypto.randomUUID(),
        idx: 0,
        phase: 'submit',
        submit_deadline_unix: Math.floor(Date.now() / 1000) + (cfg?.submit_minutes || 60) * 60
      }
    });
    this.memRoomNonces.set(client_nonce, roomId);
    return { room_id: roomId, note: 'db_fallback' };
  }
}
