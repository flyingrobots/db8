import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { RoomService } from '../services/RoomService.js';

// Regression: getRoomState read from submissions_view, which has no flag_count or
// flag_details columns, so every transcript entry reported flag_count 0 and the
// room's `flags` array was always empty no matter how many flags were recorded.
describe('RoomService flag aggregation', () => {
  let pool;
  let service;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  const roomId = '7f1a0000-0000-0000-0000-000000000001';
  const roundId = '7f1a0000-0000-0000-0000-000000000002';
  const participantId = '7f1a0000-0000-0000-0000-000000000003';
  const submissionId = '7f1a0000-0000-0000-0000-000000000004';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    service = new RoomService({
      dbRef: { pool },
      memRooms: new Map(),
      memRoomNonces: new Map(),
      memSubmissions: new Map(),
      memFlags: new Map(),
      memVoteTotals: new Map(),
      config: {}
    });

    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Flag View Room']);
    // The flag aggregation in submissions_with_flags_view only counts flags on
    // published rounds, so the round has to be published for this to mean anything.
    await pool.query(
      "insert into rounds(id, room_id, idx, phase) values ($1, $2, 0, 'published')",
      [roundId, roomId]
    );
    await pool.query('insert into participants(id, room_id, anon_name) values ($1, $2, $3)', [
      participantId,
      roomId,
      'flag_view_author'
    ]);
    await pool.query(
      `insert into submissions(id, round_id, author_id, content, canonical_sha256, client_nonce)
       values ($1, $2, $3, $4, $5, $6)`,
      [submissionId, roundId, participantId, 'contested claim', 'a'.repeat(64), 'nonce-flag-view-1']
    );
    await pool.query(
      `insert into submission_flags(submission_id, reporter_id, reporter_role, reason)
       values ($1, $2, $3, $4)`,
      [submissionId, 'judge-1', 'judge', 'unsupported']
    );
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.end();
  });

  it('reports the real flag count on the transcript entry', async () => {
    const state = await service.getRoomState(roomId);
    const entry = state.round.transcript.find((s) => s.submission_id === submissionId);
    expect(entry).toBeDefined();
    expect(entry.flag_count).toBe(1);
  });

  it('surfaces flag details rather than dropping them', async () => {
    const state = await service.getRoomState(roomId);
    const entry = state.round.transcript.find((s) => s.submission_id === submissionId);
    expect(Array.isArray(entry.flags)).toBe(true);
    expect(entry.flags).toHaveLength(1);
    expect(entry.flags[0]).toMatchObject({ reporter_role: 'judge', reason: 'unsupported' });
  });

  it('lists the submission in the room-level flags array', async () => {
    const state = await service.getRoomState(roomId);
    expect(state.flags).toEqual([{ submission_id: submissionId, flag_count: 1 }]);
  });

  it('carries the author anon name through the view', async () => {
    const state = await service.getRoomState(roomId);
    const entry = state.round.transcript.find((s) => s.submission_id === submissionId);
    expect(entry.author_anon_name).toBe('flag_view_author');
  });
});
