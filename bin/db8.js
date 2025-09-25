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

  // Basic validation
  class CLIError extends Error {
    constructor(message, exitCode = EXIT.VALIDATION) {
      super(message);
      this.name = 'CLIError';
      this.exitCode = exitCode;
    }
  }

  function validateArgs(args, cmd, subcmd) {
    // Allowed commands (cmd or cmd+subcmd mapped with ':')
    const allowed = new Set([
      'login', 'whoami', 'room:status', 'room:watch',
      'draft:open', 'draft:validate', 'submit', 'resubmit'
    ]);

    // Help handling
    if (!cmd || cmd === 'help' || args.help) return { wantHelp: true };

    const key = `${cmd}${subcmd ? ':' + subcmd : ''}`;
    if (!allowed.has(key)) {
      throw new CLIError(`Unknown command: ${cmd}${subcmd ? ' ' + subcmd : ''}`, EXIT.NOT_FOUND);
    }

    // Flags validation
    if (args.timeout !== undefined) {
      const t = Number(args.timeout);
      if (!Number.isInteger(t) || t < 0 || t > 600000) {
        throw new CLIError(`Invalid --timeout value: ${args.timeout}. Must be integer 0..600000 ms`, EXIT.VALIDATION);
      }
      args.timeout = t;
    }

    if (args.json !== undefined) {
      // convert truthy strings to boolean
      if (typeof args.json === 'string') args.json = args.json !== 'false' && args.json !== '0';
      args.json = Boolean(args.json);
    }
    if (args.quiet !== undefined) args.quiet = Boolean(args.quiet);
    if (args['non-interactive'] !== undefined) args['non-interactive'] = Boolean(args['non-interactive']);

    // Basic UUID-ish sanity for room/participant (loose check)
    const uuidRe = /^[0-9a-fA-F-]{8,}$/;
    if (args.room !== undefined && typeof args.room !== 'string') {
      throw new CLIError('--room must be a string', EXIT.VALIDATION);
    }
    if (args.room && !uuidRe.test(args.room)) {
      // not fatal; warn but continue
      printerr('--room looks non-standard (expecting uuid-like string)');
    }

    if (args.participant !== undefined && typeof args.participant !== 'string') {
      throw new CLIError('--participant must be a string', EXIT.VALIDATION);
    }

    return { wantHelp: false };
  }

  // Run validation - may throw CLIError
  const v = validateArgs(args, cmd, subcmd);
  if (v.wantHelp) {
    help();
    return EXIT.OK;
  }

  // Router (skeleton only)
  switch (`${cmd}${subcmd ? ':' + subcmd : ''}`) {
    case 'login':
      print('TODO: login flow');
      return EXIT.OK;
    case 'whoami':
      print('TODO: whoami');
      return EXIT.OK;
    case 'room:status':
      print('TODO: room status');
      return EXIT.OK;
    case 'room:watch':
      print('TODO: room watch');
      return EXIT.OK;
    case 'draft:open':
      print('TODO: draft open');
      return EXIT.OK;
    case 'draft:validate':
      print('TODO: draft validate');
      return EXIT.OK;
    case 'submit':
      print('TODO: submit');
      return EXIT.OK;
    case 'resubmit':
      print('TODO: resubmit');
      return EXIT.OK;
    default:
      // Shouldn't reach here because validateArgs checks allowed commands,
      // but return a safe error code if it does.
      printerr(`Unknown command: ${cmd}${subcmd ? ' ' + subcmd : ''}`);
      help();
      return EXIT.NOT_FOUND;
  }
}

// Top-level runner centralizes process.exit so tests can call main()
async function run() {
  try {
    const code = await main();
    process.exit(Number.isInteger(code) ? code : EXIT.OK);
  } catch (err) {
    // CLIError may carry an exitCode
    const exitCode = err && err.exitCode ? err.exitCode : EXIT.NETWORK;
    printerr(err?.stack || err?.message || String(err));
    process.exit(exitCode);
  }
}

run();

