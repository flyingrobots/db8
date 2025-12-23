export async function run(args, context) {
  const { printerr, print, apiUrl, room, participant, writeJson, sessPath, fsp, EXIT } = context;
  if (!room || !participant || !args.nonce || !args['sig-b64']) {
    printerr('auth verify requires --room, --participant, --nonce, and --sig-b64');
    return EXIT.VALIDATION;
  }
  const kind = String(args.kind || 'ed25519').toLowerCase();
  const body = {
    room_id: room,
    participant_id: participant,
    nonce: String(args.nonce),
    signature_kind: kind,
    sig_b64: String(args['sig-b64'])
  };
  if (kind === 'ed25519') {
    if (!args['pub-b64']) {
      printerr('ed25519 requires --pub-b64');
      return EXIT.VALIDATION;
    }
    body.public_key_b64 = String(args['pub-b64']);
  } else {
    if (!args['pub-ssh']) {
      printerr('ssh requires --pub-ssh');
      return EXIT.VALIDATION;
    }
    let val = String(args['pub-ssh']);
    if (val.startsWith('@')) {
      const p = val.slice(1);
      try {
        val = await fsp.readFile(p, 'utf8');
      } catch {
        printerr(`failed to read --pub-ssh file: ${p}`);
        return EXIT.VALIDATION;
      }
    }
    body.public_key_ssh = val.trim();
  }

  try {
    const url = `${apiUrl.replace(/\/$/, '')}/auth/verify`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok !== true) {
      if (args.json) print(JSON.stringify({ ok: false, status: res.status, error: data?.error }));
      else printerr(data?.error || `Server error ${res.status}`);
      return EXIT.AUTH;
    }
    // Save session if successful
    await writeJson(sessPath, {
      room_id: data.room_id,
      participant_id: data.participant_id,
      jwt: data.jwt,
      expires_at: data.expires_at,
      login_via: 'ssh'
    });
    if (args.json) print(JSON.stringify(data));
    else print('ok');
    return EXIT.OK;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
