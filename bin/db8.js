#!/usr/bin/env node

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
      'login',
      'whoami',
      'room:status',
      'room:watch',
      'draft:open',
      'draft:validate',
      'submit',
      'resubmit'
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
        throw new CLIError(
          `Invalid --timeout value: ${args.timeout}. Must be integer 0..600000 ms`,
          EXIT.VALIDATION
        );
      }
      args.timeout = t;
    }

    if (args.json !== undefined) {
      // convert truthy strings to boolean
      if (typeof args.json === 'string') args.json = args.json !== 'false' && args.json !== '0';
      args.json = Boolean(args.json);
    }
    if (args.quiet !== undefined) args.quiet = Boolean(args.quiet);
    if (args['non-interactive'] !== undefined)
      args['non-interactive'] = Boolean(args['non-interactive']);

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

  const key = `${cmd}${subcmd ? ':' + subcmd : ''}`;
  // Minimal config/session helpers
  const os = await import('node:os');
  const path = await import('node:path');
  const fsp = await import('node:fs/promises');
  const crypto = await import('node:crypto');
  const { z } = await import('zod');
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
  const room = args.room || process.env.DB8_ROOM_ID || prof.room_id || session.room_id || '';
  const participant =
    args.participant ||
    process.env.DB8_PARTICIPANT_ID ||
    prof.participant_id ||
    session.participant_id ||
    '';
  const jwt = process.env.DB8_JWT || session.jwt || '';

  // Helpers
  function randomNonce() {
    return (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');
  }

  function canonicalize(value) {
    const seen = new WeakSet();
    const walk = (v) => {
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v)) throw new Error('Cannot canonicalize circular structure');
      seen.add(v);
      if (Array.isArray(v)) return v.map(walk);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    };
    return JSON.stringify(walk(value));
  }

  function sha256Hex(s) {
    return crypto.createHash('sha256').update(s).digest('hex');
  }

  const Claim = z.object({
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
  });
  const Citation = z.object({ url: z.string().url(), title: z.string().optional() });
  const SubmissionIn = z.object({
    room_id: z.string().uuid(),
    round_id: z.string().uuid(),
    author_id: z.string().uuid(),
    phase: z.enum(['OPENING', 'ARGUMENT', 'FINAL']),
    deadline_unix: z.number().int(),
    content: z.string().min(1).max(4000),
    claims: z.array(Claim).min(1).max(5),
    citations: z.array(Citation).min(2),
    client_nonce: z.string().min(8),
    signature_kind: z.enum(['ssh', 'ed25519']).optional(),
    signature_b64: z.string().optional(),
    signer_fingerprint: z.string().optional()
  });

  async function ensureDir(p) {
    await fsp.mkdir(p, { recursive: true });
  }
  async function writeJson(p, obj) {
    await ensureDir(path.dirname(p));
    await fsp.writeFile(p, JSON.stringify(obj, null, 2));
  }
  async function readJson(p) {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  }

  // Router (skeleton + basic whoami/status)
  switch (key) {
    case 'login':
      print('TODO: login flow');
      return EXIT.OK;
    case 'whoami': {
      const out = {
        ok: true,
        room_id: room || null,
        participant_id: participant || null,
        jwt_expires_at: session.expires_at || null
      };
      if (args.json) print(JSON.stringify(out));
      else
        print(
          `room: ${out.room_id || '-'}\nparticipant: ${out.participant_id || '-'}\njwt exp: ${out.jwt_expires_at || '-'}`
        );
      return EXIT.OK;
    }
    case 'room:status': {
      if (!room) {
        printerr('No room configured. Set --room or DB8_ROOM_ID or config profile.');
        return EXIT.AUTH;
      }
      const url = `${apiUrl.replace(/\/$/, '')}/state?room_id=${encodeURIComponent(room)}`;
      try {
        const res = await fetch(url, { headers: jwt ? { authorization: `Bearer ${jwt}` } : {} });
        const body = await res.json().catch(() => ({}));
        if (args.json) print(JSON.stringify(body));
        else
          print(
            `ok: ${body.ok === true ? 'yes' : 'no'}\nrounds: ${Array.isArray(body.rounds) ? body.rounds.length : 0}`
          );
        return res.ok ? EXIT.OK : EXIT.NETWORK;
      } catch (e) {
        printerr(`Failed to fetch state: ${e?.message || e}`);
        return EXIT.NETWORK;
      }
    }
    case 'room:watch':
      print('TODO: room watch');
      return EXIT.OK;
    case 'draft:open': { // Create a local draft scaffold
      const anon = process.env.DB8_ANON || 'anon';
      const idx = args.round ? String(args.round) : '0';
      const dir = path.join(process.cwd(), 'db8', `round-${idx}`, anon);
      const file = path.join(dir, 'draft.json');
      const template = {
        phase: 'OPENING',
        deadline_unix: 0,
        content: '',
        claims: [{ id: 'c1', text: '', support: [{ kind: 'citation', ref: '' }] }],
        citations: [{ url: '' }]
      };
      await writeJson(file, template);
      if (!args.json) print(`Draft at ${file}`);
      else print(JSON.stringify({ ok: true, path: file }));
      return EXIT.OK;
    }
    case 'draft:validate': {
      const anon = process.env.DB8_ANON || 'anon';
      const idx = args.round ? String(args.round) : '0';
      const file = args.path || path.join(process.cwd(), 'db8', `round-${idx}`, anon, 'draft.json');
      try {
        const draft = await readJson(file);
        // We do not know real ids here; validate structure loosely by remapping ids
        // Require content, claims, citations min as per client-side rules
        const minimal = {
          room_id: room || '00000000-0000-0000-0000-000000000001',
          round_id: '00000000-0000-0000-0000-000000000002',
          author_id: participant || '00000000-0000-0000-0000-000000000003',
          phase: draft.phase || 'OPENING',
          deadline_unix: draft.deadline_unix || 0,
          content: draft.content,
          claims: draft.claims,
          citations: draft.citations,
          client_nonce: args.nonce || randomNonce()
        };
        SubmissionIn.parse(minimal);
        const canon = canonicalize(minimal);
        const hash = sha256Hex(canon);
        if (args.json) print(JSON.stringify({ ok: true, canonical_sha256: hash }));
        else print(`canonical_sha256: ${hash}`);
        return EXIT.OK;
      } catch (e) {
        printerr(`Invalid draft: ${e?.message || e}`);
        return EXIT.VALIDATION;
      }
    }
    case 'submit': {
      if (!room || !participant || !jwt) {
        printerr('Missing room/participant/JWT. Run db8 login or set env.');
        return EXIT.AUTH;
      }
      const anon = process.env.DB8_ANON || 'anon';
      const idx = args.round ? String(args.round) : '0';
      const file = args.path || path.join(process.cwd(), 'db8', `round-${idx}`, anon, 'draft.json');
      try {
        const draft = await readJson(file);
        const payload = {
          room_id: room,
          round_id: '00000000-0000-0000-0000-000000000002',
          author_id: participant,
          phase: draft.phase || 'OPENING',
          deadline_unix: draft.deadline_unix || 0,
          content: draft.content,
          claims: draft.claims,
          citations: draft.citations,
          client_nonce: String(args.nonce || randomNonce())
        };
        SubmissionIn.parse(payload);
        const canon = canonicalize(payload);
        const canonical_sha256 = sha256Hex(canon);
        const url = `${apiUrl.replace(/\/$/, '')}/rpc/submission.create`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${jwt}`,
            'x-db8-client-nonce': payload.client_nonce
          },
          body: JSON.stringify(payload)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          printerr(body?.error || `Server error ${res.status}`);
          return EXIT.NETWORK;
        }
        if (args.json) print(JSON.stringify({ ...body, canonical_sha256 }));
        else print(`submission_id: ${body.submission_id}\ncanonical_sha256: ${canonical_sha256}`);
        return EXIT.OK;
      } catch (e) {
        printerr(e?.message || String(e));
        return EXIT.NETWORK;
      }
    }
    case 'resubmit':
      args.nonce = randomNonce();
      // Reuse submit handler with a new nonce (simple delegation)
      process.argv = [...process.argv.slice(0, 2), 'submit', ...process.argv.slice(3)];
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
