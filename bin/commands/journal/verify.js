import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export async function run(args, context) {
  const { printerr, print, apiUrl, session, EXIT } = context;
  const roomId = args.room || process.env.DB8_ROOM_ID || session.room_id;
  const wantHistory = Boolean(args.history);

  async function verifyOne(j) {
    try {
      const pubDer = Buffer.from(j.signature.public_key_b64, 'base64');
      const pubKey = crypto.createPublicKey({ format: 'der', type: 'spki', key: pubDer });
      const ok = crypto.verify(
        null,
        Buffer.from(j.hash, 'hex'),
        pubKey,
        Buffer.from(j.signature.sig_b64, 'base64')
      );
      return Boolean(ok);
    } catch {
      return false;
    }
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
      const items = Array.isArray(body.journals) ? body.journals : [];
      let allOk = true;
      for (let i = 0; i < items.length; i++) {
        const j = items[i];
        const ok = await verifyOne(j);
        if (!ok) allOk = false;
        if (i > 0) {
          const prev = items[i - 1];
          const prevHash = (j.core && j.core.prev_hash) || null;
          if (prevHash !== prev.hash) allOk = false;
        }
      }
      if (args.json) print(JSON.stringify({ ok: allOk, count: items.length }));
      else print(allOk ? 'ok' : 'fail');
      return allOk ? EXIT.OK : EXIT.VALIDATION;
    }
    // Single latest
    const res = await fetch(`${base}/journal?room_id=${encodeURIComponent(roomId)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      printerr(body?.error || `Server error ${res.status}`);
      return EXIT.NETWORK;
    }
    const ok = await verifyOne(body.journal);
    if (args.json) print(JSON.stringify({ ok }));
    else print(ok ? 'ok' : 'fail');
    return ok ? EXIT.OK : EXIT.VALIDATION;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
