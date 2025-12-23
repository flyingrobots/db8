export async function run(args, context) {
  const { printerr, print, apiUrl, EXIT } = context;
  const roundId = String(args.round);
  try {
    const res = await fetch(
      `${apiUrl.replace(/\/$/, '')}/verify/summary?round_id=${encodeURIComponent(roundId)}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok !== true) {
      if (args.json) print(JSON.stringify({ ok: false, status: res.status, error: data?.error }));
      else printerr(data?.error || `Server error ${res.status}`);
      return EXIT.NETWORK;
    }
    if (args.json) print(JSON.stringify({ ok: true, rows: data.rows || [] }));
    else {
      const rows = data.rows || [];
      if (rows.length === 0) print('no rows');
      else
        rows.forEach((r) =>
          print(
            `${r.submission_id} ${r.claim_id ?? '-'} T:${r.true_count} F:${r.false_count} U:${r.unclear_count} N:${r.needs_work_count} Total:${r.total}`
          )
        );
    }
    return EXIT.OK;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
