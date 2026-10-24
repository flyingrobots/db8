import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { RoomService } from '../services/RoomService.js';

// Regression for #226: /state returned every submission in the room, including
// ones whose round was still in `submit`, so a debater could read an opponent's
// argument before writing their own. A submission must appear only once its
// round is published, and must stay visible after the round goes final.

function makeService(pool) {
  return new RoomService({
    dbRef: { pool },
    memRooms: new Map(),
    memRoomNonces: new Map(),
    memSubmissions: new Map(),
    memFlags: new Map(),
    memVoteTotals: new Map(),
    config: {}
  });
}

const ids = (state) => state.round.transcript.map((s) => s.submission_id).sort();

describe('/state hides submissions from rounds still in submit (DB)', () => {
  let pool;
  let service;
  const dbUrl =
    process.env.DB8_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:test@localhost:54329/db8_test';

  const roomId = '22600000-0000-0000-0000-000000000001';
  const round0 = '22600000-0000-0000-0000-000000000010';
  const round1 = '22600000-0000-0000-0000-000000000011';
  const alice = '22600000-0000-0000-0000-000000000020';
  const bob = '22600000-0000-0000-0000-000000000021';
  const published = '22600000-0000-0000-0000-000000000030';
  const pending = '22600000-0000-0000-0000-000000000031';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    service = makeService(pool);

    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.query('insert into rooms(id, title) values ($1, $2)', [roomId, 'Blind Room']);
    await pool.query(
      `insert into rounds(id, room_id, idx, phase) values
         ($1, $3, 0, 'published'),
         ($2, $3, 1, 'submit')`,
      [round0, round1, roomId]
    );
    await pool.query(
      `insert into participants(id, room_id, anon_name) values ($1, $3, 'blind_a'), ($2, $3, 'blind_b')`,
      [alice, bob, roomId]
    );
    await pool.query(
      `insert into submissions(id, round_id, author_id, content, canonical_sha256, client_nonce) values
         ($1, $3, $5, 'round 0 argument', $7, 'nonce-blind-0001'),
         ($2, $4, $6, 'secret round 1 draft', $8, 'nonce-blind-0002')`,
      [published, pending, round0, round1, alice, bob, 'a'.repeat(64), 'b'.repeat(64)]
    );
  });

  afterAll(async () => {
    await pool.query('delete from rooms where id = $1', [roomId]);
    await pool.end();
  });

  it('omits a submission whose round is still in submit', async () => {
    const state = await service.getRoomState(roomId);
    expect(state.round.phase).toBe('submit');
    expect(ids(state)).toEqual([published]);
    expect(JSON.stringify(state)).not.toContain('secret round 1 draft');
  });

  it('shows it once the round is published', async () => {
    await pool.query("update rounds set phase = 'published' where id = $1", [round1]);
    const state = await service.getRoomState(roomId);
    expect(ids(state)).toEqual([published, pending].sort());
  });

  it('keeps it visible after the round goes final', async () => {
    await pool.query("update rounds set phase = 'final' where id = $1", [round1]);
    const state = await service.getRoomState(roomId);
    expect(ids(state)).toEqual([published, pending].sort());
  });
});

describe('/state hides submissions from rounds still in submit (memory)', () => {
  const roomId = 'room-blind-memory';
  const round0 = 'round-0';
  const round1 = 'round-1';

  function seeded(phase) {
    const service = makeService(null);
    service.memRooms.set(roomId, {
      topic: 'Blind Room',
      round: { round_id: round1, idx: 1, phase, submit_deadline_unix: 0 }
    });
    const add = (round, id, content) =>
      service.memSubmissions.set(`${roomId}:${round}:author-${id}:nonce-${id}`, {
        id,
        canonical_sha256: 'c'.repeat(64),
        content,
        author_id: `author-${id}`,
        room_id: roomId,
        round_id: round
      });
    add(round0, 'sub-published', 'round 0 argument');
    add(round1, 'sub-pending', 'secret round 1 draft');
    return service;
  }

  it('omits a submission whose round is still in submit', async () => {
    const state = await seeded('submit').getRoomState(roomId);
    expect(ids(state)).toEqual(['sub-published']);
    expect(JSON.stringify(state)).not.toContain('secret round 1 draft');
  });

  it('shows it once the round is published', async () => {
    const state = await seeded('published').getRoomState(roomId);
    expect(ids(state)).toEqual(['sub-pending', 'sub-published']);
  });

  it('keeps it visible after the round goes final', async () => {
    const state = await seeded('final').getRoomState(roomId);
    expect(ids(state)).toEqual(['sub-pending', 'sub-published']);
  });
});
