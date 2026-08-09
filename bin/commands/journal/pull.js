import path from 'node:path';

export async function run(args, context) {
  const { printerr, print, apiUrl, session, homedir, ensureDir, fsp, EXIT } = context;
  const roomId = args.room || process.env.DB8_ROOM_ID || session.room_id;
  const outDir = args.out || path.join(homedir, '.db8', 'journal', roomId);
  const idx = args.round;
  const wantHistory = Boolean(args.history) && idx === undefined;

  async function writeFileJson(p, obj) {
    await ensureDir(path.dirname(p));
    await fsp.writeFile(p, JSON.stringify(obj, null, 2));
    return p;
  }

  try {
    const base = apiUrl.replace(/\/$/, '');
    if (wantHistory) {
      const res = await fetch(`${base}/journal/history?room_id=${encodeURIComponent(roomId)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        printerr(body?.error || `Server error ${res.status}`);
        return EXIT.NETWORK;
      }
      const journals = Array.isArray(body.journals) ? body.journals : [];
      const files = [];
      for (const j of journals) {
        const idxOut = Number(j.round_idx ?? (j.core && j.core.idx) ?? 0);
        const fp = path.join(outDir, `round-${idxOut}.json`);
        files.push(await writeFileJson(fp, j));
      }
      if (args.json) print(JSON.stringify({ ok: true, count: files.length, files }));
      else if (files.length === 0) print('no journals');
      else print(files.join('\n'));
      return EXIT.OK;
    }
    // Single latest or specific index
    const url =
      idx === undefined
        ? `${base}/journal?room_id=${encodeURIComponent(roomId)}`
        : `${base}/journal?room_id=${encodeURIComponent(roomId)}&idx=${idx}`;
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      printerr(body?.error || `Server error ${res.status}`);
      return EXIT.NETWORK;
    }
    const j = body.journal || body; // support either shape
    const idxOut = Number(j.round_idx ?? (j.core && j.core.idx) ?? 0);
    const fp = path.join(outDir, `round-${idxOut}.json`);
    await writeFileJson(fp, j);
    if (args.json) print(JSON.stringify({ ok: true, file: fp }));
    else print(fp);
    return EXIT.OK;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
