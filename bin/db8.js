#!/usr/bin/env node

import canonicalizePkg from 'canonicalize';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { z } from 'zod';

const EXIT = {
  OK: 0,
  VALIDATION: 2,
  AUTH: 3,
  PHASE: 4,
  RATE: 5,
  PROVENANCE: 6,
  NETWORK: 7,
  NOT_FOUND: 8,
  FAIL: 9
};

function print(msg) {
  process.stdout.write(String(msg) + '\n');
}
function printerr(msg) {
  process.stderr.write(String(msg) + '\n');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function help() {
  print(`db8 CLI
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
  room create          create a new room
  draft open           create/open draft.json
  draft validate       validate and print canonical sha
  submit               submit current draft
  resubmit             resubmit with a new nonce
  vote continue        cast a vote to continue
  vote final           cast a final approval vote
  flag submission      report a submission
  journal pull         download journal (latest or history)
  journal verify       verify journal signature and chain
  provenance enroll    enroll a participant fingerprint
  provenance verify    verify a submission signature
  verify submit        record a verification verdict
  verify summary       show per-claim/per-submission aggregates
`);
}

async function main() {
  const args = parseArgs(process.argv);
  const [cmd, subcmd] = args._;

  if (!cmd || cmd === 'help' || args.help) {
    help();
    return EXIT.OK;
  }

  // Command Mapping
  const commandMap = {
    login: './commands/identity/login.js',
    whoami: './commands/identity/whoami.js',
    'room:status': './commands/room/status.js',
    'room:watch': './commands/room/watch.js',
    'room:create': './commands/room/create.js',
    'draft:open': './commands/draft/open.js',
    'draft:validate': './commands/draft/validate.js',
    submit: './commands/submit.js',
    resubmit: './commands/resubmit.js',
    'vote:continue': './commands/vote/continue.js',
    'vote:final': './commands/vote/final.js',
    'flag:submission': './commands/flag/submission.js',
    'journal:pull': './commands/journal/pull.js',
    'journal:verify': './commands/journal/verify.js',
    'provenance:enroll': './commands/provenance/enroll.js',
    'provenance:verify': './commands/provenance/verify.js',
    'verify:submit': './commands/verify/submit.js',
    'verify:summary': './commands/verify/summary.js',
    'auth:challenge': './commands/auth/challenge.js',
    'auth:verify': './commands/auth/verify.js'
  };

  const key = subcmd && commandMap[`${cmd}:${subcmd}`] ? `${cmd}:${subcmd}` : cmd;
  const commandFile = commandMap[key];

  if (!commandFile) {
    printerr(`Unknown command: ${cmd} ${subcmd || ''}`);
    return EXIT.NOT_FOUND;
  }

  // Shared Context and Helpers
  async function readJsonSafe(p) {
    try {
      return JSON.parse(await fsp.readFile(p, 'utf8'));
    } catch {
      return null;
    }
  }

  const homedir = os.homedir();
  const cfgPath = path.join(homedir, '.db8', 'config.json');
  const sessPath = path.join(homedir, '.db8', 'session.json');
  const config = (await readJsonSafe(cfgPath)) || {};
  const session = (await readJsonSafe(sessPath)) || {};
  const apiUrl = process.env.DB8_API_URL || config.api_url || 'http://localhost:3000';
  const profile = config.default_profile || 'main';
  const prof = (config.profiles && config.profiles[profile]) || {};

  const context = {
    print,
    printerr,
    EXIT,
    apiUrl,
    room: args.room || process.env.DB8_ROOM_ID || prof.room_id || session.room_id || '',
    participant:
      args.participant ||
      process.env.DB8_PARTICIPANT_ID ||
      prof.participant_id ||
      session.participant_id ||
      '',
    jwt: args.jwt || process.env.DB8_JWT || session.jwt || '',
    session,
    config,
    homedir,
    sessPath,
    fsp,
    z,
    randomNonce: () =>
      (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex'),
    writeJson: async (p, obj) => {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, JSON.stringify(obj, null, 2));
    },
    readJson: async (p) => JSON.parse(await fsp.readFile(p, 'utf8')),
    ensureDir: async (p) => await fsp.mkdir(p, { recursive: true }),
    canonicalize: (value) => {
      const mode = String(
        process.env.DB8_CANON_MODE || process.env.CANON_MODE || 'jcs'
      ).toLowerCase();
      if (mode === 'jcs') return canonicalizePkg(value);
      return JSON.stringify(value, Object.keys(value).sort());
    },
    sha256Hex: (s) => crypto.createHash('sha256').update(s).digest('hex'),
    SubmissionIn: z.object({
      room_id: z.string().uuid(),
      round_id: z.string().uuid(),
      author_id: z.string().uuid(),
      phase: z.enum(['submit', 'published', 'final']),
      deadline_unix: z.number().int(),
      content: z.string().min(1).max(4000),
      claims: z
        .array(
          z.object({
            id: z.string(),
            text: z.string().min(3),
            support: z
              .array(
                z.object({
                  kind: z.enum(['citation', 'logic', 'data']),
                  ref: z.string()
                })
              )
              .min(1)
          })
        )
        .min(1)
        .max(5),
      citations: z
        .array(
          z.object({
            url: z.string().url(),
            title: z.string().optional()
          })
        )
        .min(2),
      client_nonce: z.string().min(8),
      signature_kind: z.enum(['ssh', 'ed25519']).optional(),
      signature_b64: z.string().optional(),
      signer_fingerprint: z.string().optional()
    })
  };

  try {
    const module = await import(commandFile);
    return await module.run(args, context);
  } catch (err) {
    printerr(err.stack || err.message || String(err));
    return EXIT.FAIL;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    printerr(err);
    process.exit(EXIT.FAIL);
  });
