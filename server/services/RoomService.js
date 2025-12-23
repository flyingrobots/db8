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
            'SELECT * FROM submissions_view WHERE room_id = $1 ORDER BY idx ASC, submitted_at ASC',
            [roomId]
          )
          .catch((e) => {
            throw new Error(`submissions_view: ${e.message}`);
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
            content: row.content,
            canonical_sha256: row.canonical_sha256,
            submitted_at: row.submitted_at,
            flag_count: Number(row.flag_count || 0)
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
      const submitWindow = Number(process.env.SUBMIT_WINDOW_SEC || 3600);
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
      const continueWindow = Number(process.env.CONTINUE_WINDOW_SEC || 30);
      room.round.continue_vote_close_unix = now + continueWindow;
    } else if (
      room.round.phase === 'published' &&
      room.round.continue_vote_close_unix > 0 &&
      now > room.round.continue_vote_close_unix
    ) {
      // Tally continue votes
      const tally = this.memVoteTotals.get(roomId) || { yes: 0, no: 0 };
      if (tally.yes > tally.no) {
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
    const transcript = Array.from(this.memSubmissions.entries())
      .filter(([key]) => key.startsWith(`${roomId}:`))
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
    this.memRooms.set(roomId, {
      topic,
      round: {
        idx: 0,
        phase: 'submit',
        submit_deadline_unix: Math.floor(Date.now() / 1000) + (cfg?.submit_minutes || 60) * 60
      }
    });
    this.memRoomNonces.set(client_nonce, roomId);
    return { room_id: roomId, note: 'db_fallback' };
  }
}
