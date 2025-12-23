export async function run(args, context) {
  const { printerr, print, apiUrl, room, participant, jwt, randomNonce, EXIT } = context;
  const approval = args.approve !== undefined ? Boolean(args.approve !== 'false') : true;
  const ranking = args.rank
    ? String(args.rank)
        .split(',')
        .map((s) => s.trim())
    : [];
  if (!room || !participant || !jwt) {
    printerr('Missing room/participant credentials. Run db8 login or set env.');
    return EXIT.AUTH;
  }
  const cn = String(args.nonce || randomNonce());
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/rpc/vote.final`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        round_id: '00000000-0000-0000-0000-000000000002', // loose stub
        voter_id: participant,
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
