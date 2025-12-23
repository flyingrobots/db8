import path from 'node:path';

export async function run(args, context) {
  const {
    printerr,
    print,
    apiUrl,
    room,
    participant,
    jwt,
    readJson,
    randomNonce,
    SubmissionIn,
    canonicalize,
    sha256Hex,
    EXIT
  } = context;
  const dryRun = Boolean(args['dry-run']);
  if (!room || !participant || (!dryRun && !jwt)) {
    printerr('Missing room/participant credentials. Run db8 login or set env.');
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
      phase: draft.phase || 'submit',
      deadline_unix: draft.deadline_unix || 0,
      content: draft.content,
      claims: draft.claims,
      citations: draft.citations,
      client_nonce: String(args.nonce || randomNonce())
    };
    SubmissionIn.parse(payload);
    const canon = canonicalize(payload);
    const canonical_sha256 = sha256Hex(canon);
    if (dryRun) {
      const info = {
        ok: true,
        dry_run: true,
        canonical_sha256,
        client_nonce: payload.client_nonce
      };
      if (args.json) print(JSON.stringify(info));
      else
        print(
          `canonical_sha256: ${canonical_sha256}\nclient_nonce: ${payload.client_nonce}\n(dry run — not submitted)`
        );
      return EXIT.OK;
    }
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
