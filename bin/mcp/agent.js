import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GUIDE, AGENT_LOOP } from './guide.js';

// MCP server that seats one LLM agent in one db8 room.
//
// It is a client of the HTTP API and nothing else: no database access, so it
// sees exactly what any other participant sees. The seat is fixed when the
// process starts, so no tool takes a room or participant argument and an agent
// cannot act for another seat through these tools. That is a property of the
// tools, not of db8: identity is unauthenticated (#210), and anyone who can
// reach the API can still post as any participant.

const MAX_WAIT_SEC = 120;
const SEAT = /^agent_[1-9][0-9]*$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function configFromEnv(env = process.env) {
  const apiUrl = (env.DB8_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const roomId = env.DB8_ROOM_ID;
  const seat = env.DB8_SEAT || undefined;
  const participantId = env.DB8_PARTICIPANT_ID || undefined;
  if (!roomId || !GUID.test(roomId)) throw new Error('DB8_ROOM_ID must be set to a room UUID');
  if (!seat && !participantId) throw new Error('set DB8_SEAT (agent_N) or DB8_PARTICIPANT_ID');
  if (seat && participantId) throw new Error('set DB8_SEAT or DB8_PARTICIPANT_ID, not both');
  if (seat && !SEAT.test(seat)) throw new Error(`DB8_SEAT must look like agent_N, got ${seat}`);
  if (participantId && !GUID.test(participantId))
    throw new Error('DB8_PARTICIPANT_ID must be a UUID');
  return { apiUrl, roomId, seat, participantId };
}

// A failure the agent can act on. Tool handlers turn it into an MCP tool error
// instead of a protocol error, so the model reads the message.
class ToolError extends Error {}

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

function guarded(fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof ToolError) return fail(err.message);
      return fail(`db8 API request failed: ${err?.message || String(err)}`);
    }
  };
}

// The API reports a Zod failure as its issue list serialized into `error`.
// Unpack it into "path: message" lines a model can map back to its input.
function describeApiError(body, status) {
  const error = body?.error ?? `HTTP ${status}`;
  if (Array.isArray(body?.details) && body.details.length > 0) {
    const lines = body.details.map(
      (d) => `- claim ${d.claim_id ?? `#${d.claim_index}`} at ${d.path}: ${d.message}`
    );
    return `${error}\n${lines.join('\n')}`;
  }
  try {
    const issues = JSON.parse(error);
    if (Array.isArray(issues)) {
      return `invalid_input\n${issues.map((i) => `- ${(i.path || []).join('.') || '(root)'}: ${i.message}`).join('\n')}`;
    }
  } catch {
    /* plain error code */
  }
  return String(error);
}

export function createAgentServer({
  apiUrl,
  roomId,
  seat,
  participantId,
  fetch: fetchImpl = globalThis.fetch,
  pollMs = 1000
}) {
  const base = apiUrl.replace(/\/+$/, '');
  const mcp = new McpServer({ name: 'db8-agent', version: '0.1.0' });

  // Rounds this process has submitted in. The server hides a round's turns until
  // it publishes, including the agent's own, so without this an agent cannot
  // tell "I have submitted" from "I have not".
  const submittedRounds = new Set();
  let roomCache = null;

  async function request(path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new ToolError(describeApiError(json, res.status));
    // The API answers 200 when it kept a write only in memory because its
    // database failed. That write is not durable and other seats may never see
    // it, so it is not a success.
    if (json.note === 'db_fallback') {
      throw new ToolError(
        'db_fallback: the db8 server could not reach its database and did not persist this request. ' +
          'Tell the debate host; do not assume it counted.'
      );
    }
    return json;
  }

  async function room() {
    if (roomCache) return roomCache;
    const r = await request(`/rpc/room.get?room_id=${encodeURIComponent(roomId)}`);
    const me = r.participants.find((p) => (seat ? p.anon_name === seat : p.id === participantId));
    if (!me) {
      const seats = r.participants.map((p) => p.anon_name).join(', ');
      throw new ToolError(
        `seat ${seat ?? participantId} is not in room ${roomId} (seats: ${seats || 'none'})`
      );
    }
    roomCache = {
      topic: r.topic,
      me: { seat: me.anon_name, participant_id: me.id, role: me.role },
      participants: r.participants,
      nameOf: new Map(r.participants.map((p) => [p.id, p.anon_name])),
      idOf: new Map(r.participants.map((p) => [p.anon_name, p.id]))
    };
    return roomCache;
  }

  function secondsUntil(unix) {
    if (!unix) return null;
    return Math.max(0, Math.round(unix - Date.now() / 1000));
  }

  function nextAction(round, submitted) {
    switch (round.phase) {
      case 'submit':
        return submitted
          ? 'You have submitted this round. Call debate_wait until the round publishes.'
          : 'Write your turn and call debate_submit before the deadline.';
      case 'published':
        return 'Read the published turns, then call debate_vote_continue with "continue" or "end".';
      case 'final':
        return 'The debate is over. Call debate_vote_final once, then stop.';
      default:
        return 'Call debate_wait.';
    }
  }

  async function snapshot() {
    const r = await room();
    const state = await request(`/state?room_id=${encodeURIComponent(roomId)}`);
    const rnd = state.round || {};
    // With a database the *_unix fields arrive as strings: pg serializes bigint
    // as text. Submitting that string back as deadline_unix fails validation.
    const unix = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const deadline =
      rnd.phase === 'submit'
        ? unix(rnd.submit_deadline_unix)
        : rnd.phase === 'published'
          ? unix(rnd.continue_vote_close_unix)
          : null;

    // Group the published transcript by round, in the order the server sent it
    // (oldest round first). Authors are shown by seat name, never by id.
    const groups = new Map();
    for (const s of rnd.transcript || []) {
      const key = s.round_id ?? 'unknown';
      if (!groups.has(key)) groups.set(key, { round_id: s.round_id, idx: s.round_idx, turns: [] });
      groups.get(key).turns.push({
        author: s.author_anon_name || r.nameOf.get(s.author_id) || 'unknown',
        content: s.content,
        canonical_sha256: s.canonical_sha256
      });
    }
    const transcript = [...groups.values()].map((g, i) => ({
      round: g.idx ?? i,
      round_id: g.round_id,
      turns: g.turns
    }));

    const submitted = submittedRounds.has(rnd.round_id);
    return {
      topic: r.topic,
      me: { seat: r.me.seat, role: r.me.role },
      seats: r.participants.map((p) => p.anon_name),
      round: {
        idx: rnd.idx,
        round_id: rnd.round_id,
        phase: rnd.phase,
        deadline_unix: deadline ?? null,
        seconds_remaining: secondsUntil(deadline),
        submitted
      },
      continue_tally: rnd.continue_tally ?? null,
      final_tally: rnd.final_tally ?? null,
      transcript,
      next_action: nextAction(rnd, submitted)
    };
  }

  function requirePhase(snap, phase, what) {
    if (snap.round.phase !== phase) {
      throw new ToolError(
        `${what} is only allowed in the "${phase}" phase; the round is in "${snap.round.phase}". ${snap.next_action}`
      );
    }
  }

  mcp.registerResource(
    'guide',
    'db8://guide',
    {
      title: 'How to write a db8 turn',
      description: 'Claim term format, citation rules, and a valid worked example.',
      mimeType: 'text/markdown'
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE }] })
  );

  mcp.registerPrompt(
    'debate_agent_loop',
    { title: 'db8 debate loop', description: 'Instructions for playing a db8 seat to the end.' },
    async () => ({ messages: [{ role: 'user', content: { type: 'text', text: AGENT_LOOP } }] })
  );

  mcp.registerTool(
    'debate_status',
    {
      title: 'Debate status',
      description:
        'Topic, your seat, the current round and phase, seconds left, vote tallies, and the published ' +
        'transcript grouped by round. Turns from a round still in "submit" are hidden, including yours.',
      annotations: { readOnlyHint: true }
    },
    guarded(async () => ok(await snapshot()))
  );

  mcp.registerTool(
    'debate_wait',
    {
      title: 'Wait for the debate to move',
      description:
        'Block until the round or phase changes, or until timeout_sec passes (default 60, max 120). ' +
        'Returns the same snapshot as debate_status, plus changed: true|false.',
      inputSchema: { timeout_sec: z.number().positive().max(MAX_WAIT_SEC).optional() },
      annotations: { readOnlyHint: true }
    },
    guarded(async ({ timeout_sec = 60 }) => {
      // A monotonic clock: the timeout is real elapsed time, independent of the
      // wall clock that round deadlines are measured against.
      const start = await snapshot();
      const until = performance.now() + timeout_sec * 1000;
      let snap = start;
      while (performance.now() < until) {
        await sleep(Math.max(0, Math.min(pollMs, until - performance.now())));
        snap = await snapshot();
        if (snap.round.round_id !== start.round.round_id || snap.round.phase !== start.round.phase)
          return ok({ changed: true, ...snap });
      }
      return ok({ changed: false, ...snap });
    })
  );

  mcp.registerTool(
    'debate_submit',
    {
      title: 'Submit your turn',
      description:
        'Submit your turn for the current round. Only allowed in the "submit" phase. ' +
        'content: prose, 1-4000 chars. claims: 1-5 items {id, term, support}, where term is a claim tree ' +
        '(read the db8://guide resource for the format and a valid example). citations: at least 2 {url, title?}. ' +
        'On a rejected term the error names the claim and the path inside its term.',
      inputSchema: {
        content: z.string().min(1).max(4000),
        claims: z
          .array(
            z.object({
              id: z.string().min(1),
              term: z.record(z.string(), z.unknown()).describe('claim term tree; see db8://guide'),
              support: z
                .array(z.object({ kind: z.enum(['citation', 'logic', 'data']), ref: z.string() }))
                .min(1)
            })
          )
          .min(1)
          .max(5),
        citations: z
          .array(z.object({ url: z.string(), title: z.string().optional() }))
          .describe('at least 2 sources')
      }
    },
    guarded(async ({ content, claims, citations }) => {
      const snap = await snapshot();
      requirePhase(snap, 'submit', 'Submitting');
      // One turn per seat per round. The API does not enforce that yet (#237),
      // so a second call here would store a second turn beside the first.
      if (snap.round.submitted) {
        throw new ToolError(
          `You already submitted in round ${snap.round.idx}. ${snap.next_action}`
        );
      }
      const { me } = await room();
      const issued = await request('/rpc/nonce.issue', {
        round_id: snap.round.round_id,
        author_id: me.participant_id
      });
      const res = await request('/rpc/submission.create', {
        room_id: roomId,
        round_id: snap.round.round_id,
        author_id: me.participant_id,
        phase: 'submit',
        deadline_unix: snap.round.deadline_unix ?? 0,
        content,
        claims,
        citations,
        client_nonce: issued.nonce
      });
      submittedRounds.add(snap.round.round_id);
      return ok({
        submitted: true,
        round: snap.round.idx,
        submission_id: res.submission_id,
        canonical_sha256: res.canonical_sha256,
        next_action: 'Call debate_wait until the round publishes.'
      });
    })
  );

  mcp.registerTool(
    'debate_vote_continue',
    {
      title: 'Vote to continue or end',
      description:
        'After a round publishes, vote "continue" for another round or "end" to finish the debate. ' +
        'Only allowed in the "published" phase, and the window is short. The next round opens only if ' +
        '"continue" votes outnumber "end" votes.',
      inputSchema: { choice: z.enum(['continue', 'end']) }
    },
    guarded(async ({ choice }) => {
      const snap = await snapshot();
      requirePhase(snap, 'published', 'A continue vote');
      const { me } = await room();
      const res = await request('/rpc/vote.continue', {
        room_id: roomId,
        round_id: snap.round.round_id,
        voter_id: me.participant_id,
        choice,
        client_nonce: crypto.randomUUID()
      });
      return ok({ voted: choice, vote_id: res.vote_id, next_action: 'Call debate_wait.' });
    })
  );

  mcp.registerTool(
    'debate_vote_final',
    {
      title: 'Cast your final vote',
      description:
        'When the debate is "final", approve or reject the debate as a whole, optionally ranking seats ' +
        'best first by seat name (for example ["agent_2", "agent_1"]).',
      inputSchema: {
        approval: z.boolean(),
        ranking: z.array(z.string().regex(SEAT)).optional()
      }
    },
    guarded(async ({ approval, ranking }) => {
      const snap = await snapshot();
      requirePhase(snap, 'final', 'A final vote');
      const r = await room();
      const ids = (ranking || []).map((name) => {
        const id = r.idOf.get(name);
        if (!id) throw new ToolError(`ranking names ${name}, which is not a seat in this room`);
        return id;
      });
      const res = await request('/rpc/vote.final', {
        round_id: snap.round.round_id,
        voter_id: r.me.participant_id,
        approval,
        ranking: ids,
        client_nonce: crypto.randomUUID()
      });
      return ok({ voted: approval ? 'approve' : 'reject', vote_id: res.vote_id });
    })
  );

  return mcp;
}
