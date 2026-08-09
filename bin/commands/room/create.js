export async function run(args, context) {
  const { printerr, print, apiUrl, randomNonce, EXIT } = context;
  const topic = args.topic || args.t;
  if (typeof topic !== 'string' || Array.from(topic).length < 3) {
    printerr('room create requires --topic <string> (min 3 chars)');
    return EXIT.VALIDATION;
  }
  const cfg = {};
  if (args.participants !== undefined) {
    const n = Number(args.participants);
    if (!Number.isInteger(n) || n < 1 || n > 64) {
      printerr('--participants must be an integer between 1 and 64');
      return EXIT.VALIDATION;
    }
    cfg.participant_count = n;
  }
  if (args['submit-minutes'] !== undefined) {
    const m = Number(args['submit-minutes']);
    if (!Number.isInteger(m) || m < 1 || m > 1440) {
      printerr('--submit-minutes must be an integer between 1 and 1440');
      return EXIT.VALIDATION;
    }
    cfg.submit_minutes = m;
  }
  const payload = {
    topic,
    ...(Object.keys(cfg).length ? { cfg } : {}),
    client_nonce: args.nonce || randomNonce()
  };
  const url = `${apiUrl.replace(/\/$/, '')}/rpc/room.create`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      printerr(body?.error || `Server error ${res.status}`);
      return EXIT.NETWORK;
    }
    if (args.json) print(JSON.stringify(body));
    else print(`room_id: ${body.room_id}`);
    return EXIT.OK;
  } catch (e) {
    printerr(`Failed to create room: ${e?.message || e}`);
    return EXIT.NETWORK;
  }
}
