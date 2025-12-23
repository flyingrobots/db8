export async function run(args, context) {
  const { printerr, print, apiUrl, session, jwt, randomNonce, EXIT } = context;
  const participantId =
    args.participant || process.env.DB8_PARTICIPANT_ID || session.participant_id || '';
  const roundId = String(args.round);
  const submissionId = String(args.submission);
  const verdict = String(args.verdict).toLowerCase();
  const claimId = args.claim ? String(args.claim) : undefined;
  const rationale = args.rationale ? String(args.rationale) : undefined;
  const cn = String(args.nonce || randomNonce());
  if (!participantId) {
    printerr('verify submit requires --participant (reporter) or configured participant');
    return EXIT.VALIDATION;
  }
  try {
    const url = `${apiUrl.replace(/\/$/, '')}/rpc/verify.submit`;
    const body = {
      round_id: roundId,
      reporter_id: participantId,
      submission_id: submissionId,
      verdict,
      client_nonce: cn,
      ...(claimId ? { claim_id: claimId } : {}),
      ...(rationale ? { rationale } : {})
    };
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
      if (res.status === 400) return EXIT.VALIDATION;
      if (res.status === 401 || res.status === 403) return EXIT.AUTH;
      return EXIT.NETWORK;
    }
    if (args.json) print(JSON.stringify({ ok: true, id: data.id }));
    else print(`ok id=${data.id}`);
    return EXIT.OK;
  } catch (e) {
    const msg = e?.message || String(e);
    printerr(msg);
    const name = (e && e.name) || '';
    const code = (e && e.code) || '';
    if (
      name === 'FetchError' ||
      name === 'AbortError' ||
      (typeof code === 'string' && /^E/.test(code))
    ) {
      return EXIT.NETWORK;
    }
    return EXIT.FAIL;
  }
}
