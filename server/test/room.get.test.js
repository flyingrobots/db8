import request from 'supertest';
import http from 'node:http';
import path from 'node:path';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import app from '../rpc.js';
import { RoomService } from '../services/RoomService.js';

// #230: a participant (or an MCP server seating an agent) needs the room's topic
// and its seats without querying Postgres. room.create returns only room_id and
// /state carries no topic or roster.

const execFile = promisify(_execFile);
const nonce = () => `room-get-${Math.random().toString(36).slice(2, 12)}`;

async function createRoom(topic, participant_count) {
  const res = await request(app)
    .post('/rpc/room.create')
    .send({ topic, cfg: { participant_count }, client_nonce: nonce() })
    .expect(200);
  return res.body.room_id;
}

describe('GET /rpc/room.get', () => {
  it('returns the topic, status and seats of a created room', async () => {
    const roomId = await createRoom('Should seats be discoverable?', 3);

    const res = await request(app).get(`/rpc/room.get?room_id=${roomId}`).expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      room_id: roomId,
      topic: 'Should seats be discoverable?',
      status: 'active'
    });
    expect(res.body.participants.map((p) => [p.anon_name, p.role])).toEqual([
      ['agent_1', 'debater'],
      ['agent_2', 'debater'],
      ['agent_3', 'debater']
    ]);
    for (const p of res.body.participants) expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(res.body.participants.map((p) => p.id)).size).toBe(3);
  });

  it('orders seats numerically, so agent_10 follows agent_9', async () => {
    const roomId = await createRoom('Ordering', 10);
    const res = await request(app).get(`/rpc/room.get?room_id=${roomId}`).expect(200);
    expect(res.body.participants.at(-1).anon_name).toBe('agent_10');
    expect(res.body.participants[1].anon_name).toBe('agent_2');
  });

  it('returns 404 for an unknown room', async () => {
    const res = await request(app)
      .get('/rpc/room.get?room_id=23000000-0000-4000-8000-000000000000')
      .expect(404);
    expect(res.body).toEqual({ ok: false, error: 'room_not_found' });
  });

  it('returns 400 when room_id is missing or not a UUID', async () => {
    await request(app).get('/rpc/room.get').expect(400);
    const res = await request(app).get('/rpc/room.get?room_id=local').expect(400);
    expect(res.body.ok).toBe(false);
  });
});

describe('RoomService.getRoom (memory)', () => {
  function memoryService() {
    return new RoomService({
      dbRef: { pool: null },
      memRooms: new Map(),
      memRoomNonces: new Map(),
      memSubmissions: new Map(),
      memFlags: new Map(),
      memVoteTotals: new Map(),
      config: {}
    });
  }

  it('seeds participant_count seats, defaulting to 4 like room_create', async () => {
    const service = memoryService();
    const { room_id } = await service.createRoom({ topic: 'Memory room', client_nonce: nonce() });
    const room = await service.getRoom(room_id);
    expect(room.topic).toBe('Memory room');
    expect(room.participants.map((p) => p.anon_name)).toEqual([
      'agent_1',
      'agent_2',
      'agent_3',
      'agent_4'
    ]);
  });

  it('does not invent a room that was never created', async () => {
    const service = memoryService();
    expect(await service.getRoom('23000000-0000-4000-8000-000000000001')).toBeNull();
  });
});

describe('CLI room seats', () => {
  let server;
  let url;
  const cli = path.join(process.cwd(), 'bin', 'db8.js');

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('prints the topic and one line per seat', async () => {
    const roomId = await createRoom('CLI seats', 2);
    const env = { ...process.env, DB8_API_URL: url, DB8_ROOM_ID: roomId };
    const { stdout } = await execFile('node', [cli, 'room', 'seats'], { env });
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toBe('topic: CLI seats');
    expect(lines.slice(1).map((l) => l.split(/\s+/).slice(0, 2))).toEqual([
      ['agent_1', 'debater'],
      ['agent_2', 'debater']
    ]);
  });

  it('emits the API response with --json', async () => {
    const roomId = await createRoom('CLI seats json', 1);
    const env = { ...process.env, DB8_API_URL: url, DB8_ROOM_ID: roomId };
    const { stdout } = await execFile('node', [cli, 'room', 'seats', '--json'], { env });
    const body = JSON.parse(stdout);
    expect(body.topic).toBe('CLI seats json');
    expect(body.participants).toHaveLength(1);
  });

  it('exits 8 for an unknown room', async () => {
    const env = {
      ...process.env,
      DB8_API_URL: url,
      DB8_ROOM_ID: '23000000-0000-4000-8000-000000000002'
    };
    const err = await execFile('node', [cli, 'room', 'seats'], { env }).catch((e) => e);
    expect(err.code).toBe(8);
    // Exit 8 alone would also match "unknown command"; require the real reason.
    expect(err.stderr).toContain('room_not_found');
  });
});

describe('room.get when the database is unreachable', () => {
  const failingPool = {
    query: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:54329');
    }
  };

  function serviceWith(pool) {
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

  it('answers 503, not 404, for a room the memory store does not hold', async () => {
    const express = (await import('express')).default;
    const { createRoomRouter } = await import('../routes/room.js');
    const mini = express();
    mini.use(
      createRoomRouter({
        roomService: serviceWith(failingPool),
        requireDbInProduction: (_q, _s, n) => n()
      })
    );

    const res = await request(mini)
      .get('/rpc/room.get?room_id=23000000-0000-4000-8000-000000000003')
      .expect(503);
    expect(res.body).toEqual({ ok: false, error: 'database_unavailable' });
  });

  it('still answers for a room that memory mode created during the outage', async () => {
    const service = serviceWith(failingPool);
    const { room_id } = await service.createRoom({
      topic: 'Made during outage',
      client_nonce: nonce()
    });
    const room = await service.getRoom(room_id);
    expect(room.topic).toBe('Made during outage');
  });
});

describe('room.get database reads', () => {
  function serviceWith(pool) {
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

  it('reads only through secure views, never base tables', async () => {
    const seen = [];
    const pool = {
      query: async (sql) => {
        seen.push(sql);
        return {
          rows: [{ id: 'r', title: 't', status: 'active', config: {} }]
        };
      }
    };
    await serviceWith(pool).getRoom('23000000-0000-4000-8000-000000000004');
    expect(seen.length).toBeGreaterThan(0);
    for (const sql of seen) {
      for (const [, table] of sql.matchAll(/\bfrom\s+([a-z_]+)/gi)) {
        expect(table).toMatch(/_view$/);
      }
    }
  });
});
