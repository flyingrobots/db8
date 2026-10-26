import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import app, { __setDbPool } from '../rpc.js';
import { SubmissionIn } from '../schemas.js';
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { createAgentServer, configFromEnv, DEFAULT_WAIT_SEC } from '../../bin/mcp/agent.js';
import { EXAMPLE_CLAIMS, EXAMPLE_CITATIONS } from '../../bin/mcp/guide.js';

// #231: an independently launched LLM agent takes one seat in a room through a
// stdio MCP server that speaks only to the HTTP API. These tests drive every tool
// through a real MCP client against an in-process API server in memory mode.

const nonce = () => `mcp-${Math.random().toString(36).slice(2, 12)}`;

let server;
let apiUrl;

async function api(path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

async function seat(roomId, seatName, opts = {}) {
  const mcp = createAgentServer({ apiUrl, roomId, seat: seatName, pollMs: 10, ...opts });
  const client = new Client({ name: `test-${seatName}`, version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(a), client.connect(b)]);
  return client;
}

async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text).join('\n');
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* error text */
  }
  return { isError: Boolean(res.isError), text, body };
}

const turn = (content) => ({ content, claims: EXAMPLE_CLAIMS, citations: EXAMPLE_CITATIONS });

beforeAll(async () => {
  // Memory mode by configuration, so the suite behaves the same with and without
  // a reachable database.
  __setDbPool(null);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('db8 MCP agent server', () => {
  it('lists the debate tools, the guide resource and the loop prompt', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Tools',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    const client = await seat(room_id, 'agent_1');
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      'debate_status',
      'debate_submit',
      'debate_vote_continue',
      'debate_vote_final',
      'debate_wait'
    ]);
    const resources = (await client.listResources()).resources.map((r) => r.uri);
    expect(resources).toContain('db8://guide');
    const guide = await client.readResource({ uri: 'db8://guide' });
    expect(guide.contents[0].text).toMatch(/Worked example/);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toContain('debate_agent_loop');
  });

  it('the worked example in the guide passes the server schema', () => {
    const parsed = SubmissionIn.safeParse({
      room_id: '00000000-0000-4000-8000-000000000001',
      round_id: '00000000-0000-4000-8000-000000000002',
      author_id: '00000000-0000-4000-8000-000000000003',
      phase: 'submit',
      deadline_unix: 0,
      content: 'example',
      claims: EXAMPLE_CLAIMS,
      citations: EXAMPLE_CITATIONS,
      client_nonce: 'example-nonce'
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('plays a round: status, readable rejections, blind submit, wait, votes, final', async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });

    const { room_id } = await api('/rpc/room.create', {
      topic: 'Should debates be blind?',
      cfg: { participant_count: 2, submit_minutes: 1 },
      client_nonce: nonce()
    });
    const a1 = await seat(room_id, 'agent_1');
    const a2 = await seat(room_id, 'agent_2');

    const s = await call(a1, 'debate_status');
    expect(s.isError).toBe(false);
    expect(s.body).toMatchObject({
      topic: 'Should debates be blind?',
      me: { seat: 'agent_1' },
      round: { idx: 0, phase: 'submit' },
      transcript: []
    });
    expect(s.body.round.seconds_remaining).toBeGreaterThan(50);
    expect(s.body.seats).toEqual(['agent_1', 'agent_2']);

    // A broken term comes back naming the claim and the node inside it.
    const bad = await call(a1, 'debate_submit', {
      ...turn('broken'),
      claims: [{ ...EXAMPLE_CLAIMS[0], term: { kind: 'claim', subject: 'x', predicate: 'Bad' } }]
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/invalid_claim_term/);
    expect(bad.text).toMatch(/c1/);

    // Too few citations is rejected with the field that failed.
    const fewCites = await call(a1, 'debate_submit', {
      ...turn('one source'),
      citations: [EXAMPLE_CITATIONS[0]]
    });
    expect(fewCites.isError).toBe(true);
    expect(fewCites.text).toMatch(/citations/);

    // Votes are refused outside their phase.
    expect((await call(a1, 'debate_vote_continue', { choice: 'continue' })).text).toMatch(
      /published/
    );
    expect((await call(a1, 'debate_vote_final', { approval: true })).isError).toBe(true);

    const ok1 = await call(a1, 'debate_submit', turn('Blind rounds stop copying.'));
    expect(ok1.isError, ok1.text).toBe(false);
    expect(ok1.body.submission_id).toMatch(/^[0-9a-f-]{36}$/);
    const again = await call(a1, 'debate_submit', turn('A second turn in the same round.'));
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already submitted/);
    const ok2 = await call(a2, 'debate_submit', turn('Blind rounds waste rebuttals.'));
    expect(ok2.isError, ok2.text).toBe(false);

    // Still blind: neither seat sees a transcript before publish.
    const blind = await call(a2, 'debate_status');
    expect(blind.body.transcript).toEqual([]);
    expect(blind.body.round.submitted).toBe(true);

    // debate_wait returns when the phase changes.
    const waiting = call(a1, 'debate_wait', { timeout_sec: 10 });
    await new Promise((r) => setTimeout(r, 30));
    vi.setSystemTime(t0 + 61_000);
    const w = await waiting;
    expect(w.isError).toBe(false);
    expect(w.body.changed).toBe(true);
    expect(w.body.round.phase).toBe('published');
    expect(w.body.transcript).toHaveLength(1);
    expect(w.body.transcript[0].round_id).toBe(s.body.round.round_id);
    expect(w.body.transcript[0].turns.map((t) => [t.author, t.content])).toEqual([
      ['agent_1', 'Blind rounds stop copying.'],
      ['agent_2', 'Blind rounds waste rebuttals.']
    ]);

    // Submitting after publish is refused by the tool before the API is called.
    expect((await call(a1, 'debate_submit', turn('late'))).text).toMatch(/submit/);

    const v1 = await call(a1, 'debate_vote_continue', { choice: 'end' });
    expect(v1.isError, v1.text).toBe(false);
    const v2 = await call(a2, 'debate_vote_continue', { choice: 'end' });
    expect(v2.isError, v2.text).toBe(false);

    vi.setSystemTime(t0 + 61_000 + 31_000);
    const fin = await call(a1, 'debate_status');
    expect(fin.body.round.phase).toBe('final');

    const f = await call(a1, 'debate_vote_final', { approval: true, ranking: ['agent_2'] });
    expect(f.isError, f.text).toBe(false);
    const unknownSeat = await call(a1, 'debate_vote_final', {
      approval: true,
      ranking: ['agent_9']
    });
    expect(unknownSeat.isError).toBe(true);
    expect(unknownSeat.text).toMatch(/agent_9/);
  });

  it('debate_wait by default returns before an SDK client times the call out', () => {
    // A default at or above the client timeout fails every argument-less wait
    // with "Request timed out" (found by the four-agent end-to-end run).
    expect(DEFAULT_WAIT_SEC * 1000).toBeLessThan(DEFAULT_REQUEST_TIMEOUT_MSEC - 5000);
  });

  it('debate_wait returns unchanged at its timeout', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Timeout',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    const a1 = await seat(room_id, 'agent_1');
    const w = await call(a1, 'debate_wait', { timeout_sec: 0.05 });
    expect(w.isError).toBe(false);
    expect(w.body.changed).toBe(false);
    expect(w.body.round.phase).toBe('submit');
  });

  it('reports a db_fallback answer as a failure, not a success', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Fallback',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    // Stand in for an API whose database failed mid-request: same answer, plus
    // the note the server adds when it kept the write only in memory.
    const fallbackFetch = async (url, init) => {
      const res = await fetch(url, init);
      if (!String(url).includes('submission.create')) return res;
      const body = await res.json();
      return new globalThis.Response(JSON.stringify({ ...body, note: 'db_fallback' }), {
        status: res.status,
        headers: { 'content-type': 'application/json' }
      });
    };
    const a1 = await seat(room_id, 'agent_1', { fetch: fallbackFetch });
    const r = await call(a1, 'debate_submit', turn('Will this persist?'));
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/db_fallback/);
  });

  it('accepts deadlines served as strings, as Postgres bigint columns are', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Bigint deadlines',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    const pgLikeFetch = async (url, init) => {
      const res = await fetch(url, init);
      if (!String(url).includes('/state')) return res;
      const body = await res.json();
      for (const k of ['submit_deadline_unix', 'published_at_unix', 'continue_vote_close_unix']) {
        if (body.round?.[k] !== undefined) body.round[k] = String(body.round[k]);
      }
      return new globalThis.Response(JSON.stringify(body), {
        status: res.status,
        headers: { 'content-type': 'application/json' }
      });
    };
    const a1 = await seat(room_id, 'agent_1', { fetch: pgLikeFetch });
    const s = await call(a1, 'debate_status');
    expect(typeof s.body.round.deadline_unix).toBe('number');
    expect(s.body.round.seconds_remaining).toBeGreaterThan(0);
    const r = await call(a1, 'debate_submit', turn('Deadline as text'));
    expect(r.isError, r.text).toBe(false);
  });

  it('identifies its room and seat to the rate limiter', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Rate partition',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    const seen = [];
    const spy = async (url, init) => {
      seen.push({ url: String(url), headers: init.headers });
      return fetch(url, init);
    };
    const a2 = await seat(room_id, 'agent_2', { fetch: spy });
    await call(a2, 'debate_status');
    const room = (await api(`/rpc/room.get?room_id=${room_id}`)).participants;
    const state = seen.find((r) => r.url.includes('/state'));
    expect(state.headers['x-room-id']).toBe(room_id);
    expect(state.headers['x-participant-id']).toBe(room.find((p) => p.anon_name === 'agent_2').id);
  });

  it('debate_wait backs off on 429 instead of failing', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Throttled wait',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    let stateCalls = 0;
    const throttled = async (url, init) => {
      if (String(url).includes('/state') && ++stateCalls > 1 && stateCalls <= 3) {
        return new globalThis.Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json' }
        });
      }
      return fetch(url, init);
    };
    const a1 = await seat(room_id, 'agent_1', { fetch: throttled });
    const w = await call(a1, 'debate_wait', { timeout_sec: 0.2 });
    expect(w.isError, w.text).toBe(false);
    expect(w.body.changed).toBe(false);
    expect(stateCalls).toBeGreaterThan(3);
  });

  it('accepts one of two concurrent submissions in a round', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Concurrent submit',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    const a1 = await seat(room_id, 'agent_1');
    const results = await Promise.all([
      call(a1, 'debate_submit', turn('first')),
      call(a1, 'debate_submit', turn('second'))
    ]);
    expect(results.filter((r) => !r.isError)).toHaveLength(1);
    expect(results.find((r) => r.isError).text).toMatch(/already submitted/);
  });

  it('a repeated continue vote revises the ballot instead of adding one', async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Repeat vote',
      cfg: { participant_count: 2, submit_minutes: 1 },
      client_nonce: nonce()
    });
    const a1 = await seat(room_id, 'agent_1');
    vi.setSystemTime(t0 + 61_000);
    expect((await call(a1, 'debate_status')).body.round.phase).toBe('published');
    expect((await call(a1, 'debate_vote_continue', { choice: 'continue' })).isError).toBe(false);
    expect((await call(a1, 'debate_vote_continue', { choice: 'continue' })).isError).toBe(false);
    const s = await call(a1, 'debate_status');
    expect(s.body.continue_tally).toEqual({ yes: 1, no: 0 });
  });

  it('debate_wait stays within timeout_sec when the API is slow', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Slow API',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    const a1 = await seat(room_id, 'agent_1');
    await call(a1, 'debate_status'); // resolve the seat before timing
    const slow = async (url, init) => {
      if (String(url).includes('/state')) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 150);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(init.signal.reason);
          });
        });
      }
      return fetch(url, init);
    };
    const slowSeat = await seat(room_id, 'agent_1', { fetch: slow });
    await call(slowSeat, 'debate_status').catch(() => {});
    const started = performance.now();
    const w = await call(slowSeat, 'debate_wait', { timeout_sec: 0.05 });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(140);
    expect(w.isError).toBe(true);
    expect(w.text).toMatch(/timeout_sec|did not answer/);
  });

  it('a revised continue vote replaces the earlier choice in memory mode', async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Revise vote',
      cfg: { participant_count: 2, submit_minutes: 1 },
      client_nonce: nonce()
    });
    const a1 = await seat(room_id, 'agent_1');
    vi.setSystemTime(t0 + 61_000);
    await call(a1, 'debate_vote_continue', { choice: 'continue' });
    await call(a1, 'debate_vote_continue', { choice: 'end' });
    const s = await call(a1, 'debate_status');
    expect(s.body.continue_tally).toEqual({ yes: 0, no: 1 });
  });

  it('after voting, status reports the vote and points at debate_wait', async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Voted flag',
      cfg: { participant_count: 2, submit_minutes: 1 },
      client_nonce: nonce()
    });
    const a1 = await seat(room_id, 'agent_1');
    vi.setSystemTime(t0 + 61_000);
    expect((await call(a1, 'debate_status')).body.round.voted).toBe(false);
    await call(a1, 'debate_vote_continue', { choice: 'continue' });
    const s = await call(a1, 'debate_status');
    expect(s.body.round.voted).toBe(true);
    expect(s.body.next_action).toMatch(/debate_wait/);
  });

  it('retrying a submission whose response was lost does not store a second turn', async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Lost response',
      cfg: { participant_count: 2, submit_minutes: 1 },
      client_nonce: nonce()
    });
    let creates = 0;
    let issues = 0;
    const lossy = async (url, init) => {
      if (String(url).includes('nonce.issue')) issues += 1;
      if (String(url).includes('submission.create') && ++creates === 1) {
        await fetch(url, init); // the server stores the turn...
        throw new TypeError('fetch failed'); // ...and the answer never arrives
      }
      return fetch(url, init);
    };
    const a1 = await seat(room_id, 'agent_1', { fetch: lossy });
    const first = await call(a1, 'debate_submit', turn('Only once.'));
    expect(first.isError).toBe(true);
    const retry = await call(a1, 'debate_submit', turn('Only once.'));
    expect(retry.isError, retry.text).toBe(false);
    expect(issues).toBe(1);
    vi.setSystemTime(t0 + 61_000);
    const s = await call(a1, 'debate_status');
    expect(s.body.transcript[0].turns.filter((t) => t.author === 'agent_1')).toHaveLength(1);
  });

  it('gives up on a request the API never answers', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Stalled',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    const stall = async (url, init) => {
      if (!String(url).includes('/state')) return fetch(url, init);
      return new Promise((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal.reason))
      );
    };
    const a1 = await seat(room_id, 'agent_1', { fetch: stall, requestTimeoutMs: 50 });
    const started = performance.now();
    const r = await call(a1, 'debate_status');
    expect(performance.now() - started).toBeLessThan(1000);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/did not answer/);
  });

  it('numbers rounds correctly when a memory round published with no turns', async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Empty first round',
      cfg: { participant_count: 2, submit_minutes: 1 },
      client_nonce: nonce()
    });
    const a1 = await seat(room_id, 'agent_1');
    const a2 = await seat(room_id, 'agent_2');
    vi.setSystemTime(t0 + 61_000); // round 0 publishes empty
    await call(a1, 'debate_vote_continue', { choice: 'continue' });
    await call(a2, 'debate_vote_continue', { choice: 'continue' });
    vi.setSystemTime(t0 + 92_000); // round 1 opens
    expect((await call(a1, 'debate_status')).body.round.idx).toBe(1);
    expect((await call(a1, 'debate_submit', turn('Round one turn'))).isError).toBe(false);
    vi.setSystemTime(t0 + 92_000 + 301_000); // round 1 publishes
    const s = await call(a1, 'debate_status');
    expect(s.body.transcript.map((g) => g.round)).toEqual([1]);
  });

  it('refuses a seat the room does not have', async () => {
    const { room_id } = await api('/rpc/room.create', {
      topic: 'Seats',
      cfg: { participant_count: 2 },
      client_nonce: nonce()
    });
    const a9 = await seat(room_id, 'agent_9');
    const r = await call(a9, 'debate_status');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/agent_9/);
  });
});

describe('configFromEnv', () => {
  it('reads the API URL, room and seat', () => {
    expect(
      configFromEnv({
        DB8_API_URL: 'http://h:1/',
        DB8_ROOM_ID: '00000000-0000-4000-8000-000000000001',
        DB8_SEAT: 'agent_2'
      })
    ).toEqual({
      apiUrl: 'http://h:1',
      roomId: '00000000-0000-4000-8000-000000000001',
      seat: 'agent_2',
      participantId: undefined
    });
  });

  it('defaults the API URL and accepts a participant id instead of a seat', () => {
    const c = configFromEnv({
      DB8_ROOM_ID: '00000000-0000-4000-8000-000000000001',
      DB8_PARTICIPANT_ID: '00000000-0000-4000-8000-000000000002'
    });
    expect(c.apiUrl).toBe('http://localhost:3000');
    expect(c.participantId).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('rejects a missing room, a missing seat, and both seat forms at once', () => {
    expect(() => configFromEnv({ DB8_SEAT: 'agent_1' })).toThrow(/DB8_ROOM_ID/);
    expect(() => configFromEnv({ DB8_ROOM_ID: '00000000-0000-4000-8000-000000000001' })).toThrow(
      /DB8_SEAT/
    );
    expect(() =>
      configFromEnv({
        DB8_ROOM_ID: '00000000-0000-4000-8000-000000000001',
        DB8_SEAT: 'agent_1',
        DB8_PARTICIPANT_ID: '00000000-0000-4000-8000-000000000002'
      })
    ).toThrow(/not both/);
  });
});
