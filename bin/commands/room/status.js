export async function run(args, context) {
  const { printerr, print, apiUrl, room, jwt, EXIT } = context;
  if (!room) {
    printerr('No room configured. Set --room or DB8_ROOM_ID or config profile.');
    return EXIT.AUTH;
  }
  const url = `${apiUrl.replace(/\/$/, '')}/state?room_id=${encodeURIComponent(room)}`;
  try {
    const res = await fetch(url, { headers: jwt ? { authorization: `Bearer ${jwt}` } : {} });
    const body = await res.json().catch(() => ({}));
    if (args.json) {
      print(JSON.stringify(body));
    } else {
      const rnd = body.round || {};
      const now = Math.floor(Date.now() / 1000);
      function rem(sec) {
        const s = Math.max(0, sec - now);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `${mm}:${ss}`;
      }
      let line2 = '';
      if (rnd.phase === 'submit' && rnd.submit_deadline_unix) {
        line2 = `submit closes in ${rem(rnd.submit_deadline_unix)}`;
      } else if (rnd.phase === 'published' && rnd.continue_vote_close_unix) {
        const t = rnd.continue_tally || { yes: 0, no: 0 };
        line2 = `continue vote ${rem(rnd.continue_vote_close_unix)} (yes:${t.yes} no:${t.no})`;
      } else if (rnd.phase === 'final') {
        line2 = 'final';
      }
      print(`ok: ${body.ok === true ? 'yes' : 'no'}`);
      print(`round: ${rnd.idx ?? '-'} phase: ${rnd.phase ?? '-'}`);
      if (line2) print(line2);
    }
    return res.ok ? EXIT.OK : EXIT.NETWORK;
  } catch (e) {
    printerr(`Failed to fetch state: ${e?.message || e}`);
    return EXIT.NETWORK;
  }
}
