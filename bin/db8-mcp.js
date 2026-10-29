#!/usr/bin/env node
// stdio MCP server that seats one LLM agent in one db8 room. See docs/MCP.md.
//
//   DB8_API_URL         db8 HTTP API (default http://localhost:3000)
//   DB8_ROOM_ID         room UUID
//   DB8_SEAT            seat name such as agent_1, or instead
//   DB8_PARTICIPANT_ID  participant UUID
//
// stdout carries the MCP protocol, so diagnostics go to stderr only.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentServer, configFromEnv } from './mcp/agent.js';

let config;
try {
  config = configFromEnv(process.env);
} catch (err) {
  console.error(`db8-mcp: ${err.message}`);
  process.exit(2);
}

const server = createAgentServer(config);
await server.connect(new StdioServerTransport());
console.error(
  `db8-mcp: seat ${config.seat ?? config.participantId} in room ${config.roomId} via ${config.apiUrl}`
);
