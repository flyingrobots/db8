#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const EXIT = {
  OK: 0,
  VALIDATION: 2,
  AUTH: 3,
  PHASE: 4,
  RATE: 5,
  PROVENANCE: 6,
  NETWORK: 7,
  NOT_FOUND: 8
};

function print(msg) { process.stdout.write(String(msg) + '\n'); }
function printerr(msg) { process.stderr.write(String(msg) + '\n'); }

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      args[key] = val;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function help() {
  print(`db8 CLI (skeleton)
Usage: db8 <command> [options]

Global options:
  --room <uuid>        override room
  --participant <uuid> override participant
  --json               machine-readable output
  --quiet              suppress non-errors
  --non-interactive    fail instead of prompting
  --timeout <ms>       RPC timeout
  --nonce <id>         client idempotency key

Commands:
  login                obtain a room-scoped JWT
  whoami               print current identity
  room status          show room snapshot
  room watch           stream events (WS/SSE)
  draft open           create/open draft.json
  draft validate       validate and print canonical sha
  submit               submit current draft
  resubmit             resubmit with a new nonce
`);
}

async function main() {
  const args = parseArgs(process.argv);
  const [cmd, subcmd] = args._;

  if (!cmd || cmd === 'help' || args.help) {
    help();
    process.exit(EXIT.OK);
  }

  // Router (skeleton only)
  switch (`${cmd}${subcmd ? ':' + subcmd : ''}`) {
    case 'login':
      print('TODO: login flow');
      process.exit(EXIT.OK);
    case 'whoami':
      print('TODO: whoami');
      process.exit(EXIT.OK);
    case 'room:status':
      print('TODO: room status');
      process.exit(EXIT.OK);
    case 'room:watch':
      print('TODO: room watch');
      process.exit(EXIT.OK);
    case 'draft:open':
      print('TODO: draft open');
      process.exit(EXIT.OK);
    case 'draft:validate':
      print('TODO: draft validate');
      process.exit(EXIT.OK);
    case 'submit':
      print('TODO: submit');
      process.exit(EXIT.OK);
    case 'resubmit':
      print('TODO: resubmit');
      process.exit(EXIT.OK);
    default:
      printerr(`Unknown command: ${cmd}${subcmd ? ' ' + subcmd : ''}`);
      help();
      process.exit(EXIT.NOT_FOUND);
  }
}

main().catch((err) => {
  printerr(err?.stack || err?.message || String(err));
  process.exit(EXIT.NETWORK);
});

