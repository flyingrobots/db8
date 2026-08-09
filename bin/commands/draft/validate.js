import path from 'node:path';

export async function run(args, context) {
  const {
    printerr,
    print,
    room,
    participant,
    readJson,
    randomNonce,
    SubmissionIn,
    canonicalize,
    sha256Hex,
    EXIT
  } = context;
  const anon = process.env.DB8_ANON || 'anon';
  const idx = args.round ? String(args.round) : '0';
  const file = args.path || path.join(process.cwd(), 'db8', `round-${idx}`, anon, 'draft.json');
  try {
    const draft = await readJson(file);
    const minimal = {
      room_id: room || '00000000-0000-0000-0000-000000000001',
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: participant || '00000000-0000-0000-0000-000000000003',
      phase: draft.phase || 'submit',
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
