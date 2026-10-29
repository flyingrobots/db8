export async function run(args, context) {
  const { printerr, print, apiUrl, room, EXIT } = context;
  if (!room) {
    printerr('No room configured. Set --room or DB8_ROOM_ID or config profile.');
    return EXIT.AUTH;
  }
  const url = `${apiUrl.replace(/\/$/, '')}/rpc/room.get?room_id=${encodeURIComponent(room)}`;
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) {
      printerr(`room_not_found: ${room}`);
      return EXIT.NOT_FOUND;
    }
    if (res.status === 400) {
      printerr(`${body.error || 'invalid_room_id'}: ${room}`);
      return EXIT.VALIDATION;
    }
    if (!res.ok) {
      printerr(body.error || `HTTP ${res.status}`);
      return EXIT.NETWORK;
    }
    if (args.json) {
      print(JSON.stringify(body));
      return EXIT.OK;
    }
    print(`topic: ${body.topic ?? ''}`);
    for (const p of body.participants || []) {
      print(`${p.anon_name} ${p.role} ${p.id}`);
    }
    return EXIT.OK;
  } catch (e) {
    printerr(`Failed to fetch room: ${e?.message || e}`);
    return EXIT.NETWORK;
  }
}
