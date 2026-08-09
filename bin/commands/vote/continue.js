export async function run(args, context) {
  const { printerr, print, apiUrl, room, participant, jwt, randomNonce, EXIT, z } = context;
  const base = apiUrl.replace(/\/$/, '');
  const positional = Array.isArray(args._) ? args._.slice(2) : [];
  const rawChoice = args.choice !== undefined ? args.choice : positional[0];
  const rawRound = args.round !== undefined ? args.round : args.round_id;

  if (!room || !participant || !jwt) {
    printerr('Missing room/participant credentials. Run db8 login or set env.');
    return EXIT.AUTH;
  }

  const parsed = z
    .object({
      room: z.guid(),
      participant: z.guid(),
      jwt: z.string().min(1),
      choice: z.enum(['continue', 'end']),
      round: z.guid().optional(),
      nonce: z.string().min(8).optional()
    })
    .safeParse({
      room,
      participant,
      jwt,
      choice: String(rawChoice || ''),
      round: rawRound ? String(rawRound) : undefined,
      nonce: args.nonce ? String(args.nonce) : undefined
    });

  if (!parsed.success) {
    printerr('Invalid vote continue arguments.');
    for (const issue of parsed.error.issues)
      printerr(`- ${issue.path.join('.')}: ${issue.message}`);
    printerr('Usage: db8 vote continue --choice <continue|end> [--round <uuid>]');
    return EXIT.VALIDATION;
  }

  const cn = String(parsed.data.nonce || randomNonce());

  async function resolveRoundId() {
    if (parsed.data.round) return { ok: true, roundId: parsed.data.round };
    try {
      const res = await fetch(`${base}/state?room_id=${encodeURIComponent(parsed.data.room)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          code: EXIT.NETWORK,
          message: body?.error || `Server error ${res.status}`
        };
      }
      const rid = body?.round?.round_id;
      if (!rid || !z.guid().safeParse(rid).success) {
        return {
          ok: false,
          code: EXIT.NOT_FOUND,
          message: 'Could not resolve round_id from /state. Pass --round <uuid>.'
        };
      }
      return { ok: true, roundId: String(rid) };
    } catch (e) {
      return { ok: false, code: EXIT.NETWORK, message: e?.message || String(e) };
    }
  }

  const resolved = await resolveRoundId();
  if (!resolved.ok) {
    printerr(resolved.message);
    return resolved.code;
  }
  const roundId = resolved.roundId;

  try {
    const res = await fetch(`${base}/rpc/vote.continue`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        room_id: parsed.data.room,
        round_id: roundId,
        voter_id: parsed.data.participant,
        choice: parsed.data.choice,
        client_nonce: cn
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      printerr(body?.error || `Server error ${res.status}`);
      return EXIT.NETWORK;
    }
    if (args.json) print(JSON.stringify(body));
    else print('ok');
    return EXIT.OK;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
