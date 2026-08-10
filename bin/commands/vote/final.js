export async function run(args, context) {
  const { printerr, print, apiUrl, room, participant, jwt, randomNonce, EXIT, z } = context;
  const base = apiUrl.replace(/\/$/, '');
  const approval = args.approve !== undefined ? Boolean(args.approve !== 'false') : true;
  const ranking = args.rank
    ? String(args.rank)
        .split(',')
        .map((s) => s.trim())
    : [];
  const rawRound = args.round !== undefined ? args.round : args.round_id;

  if (!participant || !jwt) {
    printerr('Missing participant/jwt credentials. Run db8 login or set env.');
    return EXIT.AUTH;
  }

  const parsed = z
    .object({
      participant: z.guid(),
      jwt: z.string().min(1),
      room: z.guid().optional(),
      round: z.guid().optional(),
      nonce: z.string().min(8).optional()
    })
    .safeParse({
      room: room ? String(room) : undefined,
      round: rawRound ? String(rawRound) : undefined,
      participant,
      jwt,
      nonce: args.nonce ? String(args.nonce) : undefined
    });

  if (!parsed.success) {
    printerr('Invalid vote final arguments.');
    for (const issue of parsed.error.issues)
      printerr(`- ${issue.path.join('.')}: ${issue.message}`);
    printerr('Usage: db8 vote final [--approve|--approve false] [--round <uuid>]');
    return EXIT.VALIDATION;
  }

  async function resolveRoundId() {
    if (parsed.data.round) return { ok: true, roundId: parsed.data.round };
    if (!parsed.data.room) {
      return { ok: false, code: EXIT.VALIDATION, message: 'Missing --room or --round <uuid>.' };
    }
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

  const cn = String(parsed.data.nonce || randomNonce());
  try {
    const res = await fetch(`${base}/rpc/vote.final`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        round_id: resolved.roundId,
        voter_id: parsed.data.participant,
        approval,
        ranking,
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
