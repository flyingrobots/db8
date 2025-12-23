export async function run(args, context) {
  const { printerr, print, apiUrl, readJson, fsp, EXIT } = context;
  const kind = String(args.kind || 'ed25519').toLowerCase();
  const file = String(args.file || args.path || '');
  try {
    const doc = await readJson(file);
    const body = { doc, signature_kind: kind };
    if (kind === 'ed25519') {
      body.sig_b64 = String(args['sig-b64']);
      body.public_key_b64 = String(args['pub-b64']);
    } else if (kind === 'ssh') {
      body.sig_b64 = String(args['sig-b64'] || '');
      if (args['pub-ssh']) {
        let val = String(args['pub-ssh']);
        if (val.startsWith('@')) {
          const p = val.slice(1);
          if (!p) return EXIT.VALIDATION;
          try {
            val = await fsp.readFile(p, 'utf8');
          } catch {
            return EXIT.VALIDATION;
          }
        }
        body.public_key_ssh = val.trim();
      }
    }
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/rpc/provenance.verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok !== true) {
      if (args.json) print(JSON.stringify({ ok: false, status: res.status, error: data?.error }));
      else printerr(data?.error || `Server error ${res.status}`);
      return EXIT.PROVENANCE;
    }
    if (args.json) {
      print(JSON.stringify(data));
    } else {
      const fp = data.public_key_fingerprint || '';
      const bind = data.author_binding || 'unknown';
      print(`ok ${data.hash}${fp ? ` fp=${fp}` : ''} binding=${bind}`);
    }
    return EXIT.OK;
  } catch (e) {
    printerr(e?.message || String(e));
    return EXIT.NETWORK;
  }
}
