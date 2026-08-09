export async function run(args, context) {
  const { printerr, print, apiUrl, room, participant, EXIT } = context;
  if (!room || !participant) {
    printerr('auth challenge requires --room and --participant');
    return EXIT.VALIDATION;
  }
  try {
    const url = `${apiUrl.replace(/\/$/, '')}/auth/challenge?room_id=${encodeURIComponent(room)}&participant_id=${encodeURIComponent(participant)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok !== true) {
      if (args.json) print(JSON.stringify({ ok: false, status: res.status, error: data?.error }));
      else printerr(data?.error || `Server error ${res.status}`);
      return EXIT.NETWORK;
    }
    if (args.json) print(JSON.stringify(data));
    else print(data.nonce);
    return EXIT.OK;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
