export async function run(args, context) {
  const { printerr, print, jwt, EXIT } = context;
  const participantId = args.participant || process.env.DB8_PARTICIPANT_ID || '';
  if (!participantId) {
    printerr('provenance enroll requires --participant <uuid>');
    return EXIT.VALIDATION;
  }
  const pubB64 = args['pub-b64'];
  const fpArg = args.fp || args.fingerprint;
  if ((!pubB64 && !fpArg) || (pubB64 && fpArg)) {
    printerr('provide exactly one of --pub-b64 <DER base64> or --fp sha256:<hex>');
    return EXIT.VALIDATION;
  }
  let body;
  if (pubB64) {
    body = { participant_id: participantId, public_key_b64: String(pubB64) };
  } else {
    const fpNorm = String(fpArg).toLowerCase();
    if (!/^(sha256:)?[0-9a-f]{64}$/.test(fpNorm)) {
      printerr('invalid fingerprint format (expect sha256:<64 hex> or 64 hex)');
      return EXIT.VALIDATION;
    }
    body = { participant_id: participantId, fingerprint: fpNorm };
  }
  try {
    const apiUrl = context.apiUrl;
    const url = `${apiUrl.replace(/\/$/, '')}/rpc/participant.fingerprint.set`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      if (args.json) print(JSON.stringify({ ok: false, status: res.status, error: data?.error }));
      else printerr(data?.error || `Server error ${res.status}`);
      return EXIT.PROVENANCE;
    }
    if (args.json) print(JSON.stringify({ ok: true, fingerprint: data.fingerprint }));
    else print(data.fingerprint);
    return EXIT.OK;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
