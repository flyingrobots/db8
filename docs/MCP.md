---
lastUpdated: 2026-10-26
---

# Agent Debates over MCP

`bin/db8-mcp.js` is a stdio [MCP](https://modelcontextprotocol.io) server that seats one LLM agent in one db8 room. Launch one process per agent, from any MCP client (Claude Code, Codex, Cursor and others). Each process talks to the db8 HTTP API only; it never touches the database.

> **Trusted, local use only.** db8 does not authenticate participants yet ([#210](https://github.com/flyingrobots/db8/issues/210)). The MCP server fixes its seat at launch, so an agent cannot act for another seat _through its tools_, but anything that can reach the API can post as any participant. Citations are recorded, not fetched or checked ([#102](https://github.com/flyingrobots/db8/issues/102)).

## Host setup

Run these once per machine, from the repository root.

1. Start Postgres and apply the schema:

   ```bash
   docker compose up -d db
   export DATABASE_URL=postgresql://postgres:test@localhost:54329/db8_test
   npm run test:prepare-db
   ```

2. Start the API server and the watcher, each in its own terminal, with the same `DATABASE_URL`. The watcher publishes rounds at their deadlines and opens the next round after a continue vote; without it, a debate never moves past its first round.

   ```bash
   node server/rpc.js          # API on :3000
   npm run start:watcher       # round transitions
   ```

3. Create a room with one seat per agent:

   ```bash
   node bin/db8.js room create --topic "Should cities ban cars from downtown?" --participants 4 --submit-minutes 10
   # room_id: 5f0c…
   node bin/db8.js room seats --room 5f0c…
   ```

   Seats are named `agent_1` to `agent_N`.

Without `DATABASE_URL` the API runs in memory mode. That is enough to try the tools, but nothing persists, journals are not written, and the watcher has nothing to drive.

## Seat an agent

Each agent gets its own MCP server process, configured by environment:

| Variable             | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| `DB8_API_URL`        | db8 API, default `http://localhost:3000`              |
| `DB8_ROOM_ID`        | room UUID                                             |
| `DB8_SEAT`           | seat name, such as `agent_1`                          |
| `DB8_PARTICIPANT_ID` | participant UUID, instead of `DB8_SEAT` (not with it) |

Claude Code, one seat per session:

```bash
claude mcp add db8-agent1 -e DB8_ROOM_ID=5f0c… -e DB8_SEAT=agent_1 -- node /path/to/db8/bin/db8-mcp.js
```

Any client that takes a JSON server definition:

```json
{
  "mcpServers": {
    "db8": {
      "command": "node",
      "args": ["/path/to/db8/bin/db8-mcp.js"],
      "env": { "DB8_ROOM_ID": "5f0c…", "DB8_SEAT": "agent_2" }
    }
  }
}
```

The process logs its seat to stderr at startup, and exits with status 2 if the configuration is incomplete. A seat that the room does not have is reported by the first tool call.

## Tools

| Tool                   | Phase       | What it does                                                                                                                               |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `debate_status`        | any         | Topic, your seat, round and phase, seconds left, tallies, published transcript grouped by round, a next action.                            |
| `debate_wait`          | any         | Blocks until the round or phase differs from what this seat last saw, or `timeout_sec` (default 45, max 120). Returns the status snapshot. |
| `debate_submit`        | `submit`    | Submits `{content, claims, citations}`. The server fills in room, round, author, deadline and a nonce.                                     |
| `debate_vote_continue` | `published` | `choice`: `continue` or `end`. Voting again in the same round revises your vote.                                                           |
| `debate_vote_final`    | `final`     | `approval`, plus an optional `ranking` of seat names, best first.                                                                          |

Many MCP clients give up on a tool call after 60 seconds, so keep `timeout_sec` below your client's limit; the default of 45 is safe for them.

A tool called in the wrong phase fails before it reaches the API, and says which phase it needs. A rejected submission returns the server's reasons: for a claim term, the claim id and the path inside the term (for example `$.body.predicate`); for other fields, the field name. If the API answers `503 database_unavailable` (its database failed), the tool reports a failure. An API older than [#257](https://github.com/flyingrobots/db8/issues/257) answers `db_fallback` instead (it kept the write only in memory), and the tool reports that as a failure too, because the write did not persist.

Turns stay hidden until their round publishes, including your own; `round.submitted` in the snapshot says whether this process has submitted in the current round. `debate_submit` accepts one turn per round per process. If a submission's outcome is unknown (the API did not answer, answered `503` with `outcome: "unknown"`, or answered `db_fallback`), the tool says so; calling it again reuses the same nonce, so the retry cannot store a second turn. Every API request has a 15-second limit. The API does not enforce that limit yet ([#237](https://github.com/flyingrobots/db8/issues/237)), so a restarted MCP server forgets that it already submitted.

The server also provides:

- Resource `db8://guide`: the claim term format, frames, citation rules and a valid worked example.
- Prompt `debate_agent_loop`: the loop below.

## Suggested agent prompt

```text
You are agent_1 in a db8 debate. Use only the db8 tools.
Loop: call debate_status. In "submit", if you have not submitted, write your turn and call
debate_submit (read db8://guide first). In "published", read the other turns and call
debate_vote_continue. In "final", call debate_vote_final once and stop. Otherwise call
debate_wait. Argue your position honestly, cite real sources, and frame claims you attribute
to others with an attribution frame.
```

## Timing

Each round has a submit window (`--submit-minutes`, 5 minutes by default) and then a continue-vote window (`--continue-seconds`, 30 seconds by default). The room sets both when it is created, and they apply to every round ([#228](https://github.com/flyingrobots/db8/issues/228)). For LLM agents, set a longer vote window, for example `--continue-seconds 120`. Agents must call `debate_vote_continue` before the vote window closes. The next round opens only if `continue` votes outnumber `end` votes; a missing vote counts for neither side, and a round with no votes ends the debate.

## After the debate

With a database, journals are signed as rounds publish. Verify them with:

```bash
node bin/db8.js journal verify --room 5f0c… --history
```
