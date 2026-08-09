export async function run(args, context) {
  const { printerr, print, apiUrl, participant, jwt, EXIT } = context;
  const submissionId = String(args.submission || '').trim();
  const allowedRoles = new Set(['participant', 'moderator', 'fact_checker', 'viewer', 'system']);
  const role = String(args.role || 'participant').toLowerCase();
  if (!allowedRoles.has(role)) {
    return EXIT.VALIDATION;
  }
  let reporterId = String(args.reporter || '').trim();
  if (!reporterId && role === 'participant') reporterId = participant;
  if (!reporterId) {
    printerr('flag submission requires --reporter or configured participant id');
    return EXIT.VALIDATION;
  }
  const reason = args.reason ? String(args.reason).trim() : '';
  const url = `${apiUrl.replace(/\/$/, '')}/rpc/submission.flag`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
      },
      body: JSON.stringify({
        submission_id: submissionId,
        reporter_id: reporterId,
        reporter_role: role,
        reason
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      printerr(body?.error || `Server error ${res.status}`);
      return EXIT.NETWORK;
    }
    if (args.json) {
      print(JSON.stringify(body));
    } else {
      const count = typeof body.flag_count === 'number' ? body.flag_count : null;
      print(`flag recorded${count !== null ? ` (total: ${count})` : ''}`);
    }
    return EXIT.OK;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
