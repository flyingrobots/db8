'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

function apiBase() {
  const u = process.env.NEXT_PUBLIC_DB8_API_URL || 'http://localhost:3000';
  return u.replace(/\/$/, '');
}

async function verifySig(j) {
  try {
    const b64 = (s) => Uint8Array.from(globalThis.atob(s), (c) => c.charCodeAt(0));
    const pubDer = b64(j.signature.public_key_b64);
    const pubKey = await (globalThis.crypto || window.crypto).subtle.importKey(
      'spki',
      pubDer,
      { name: 'Ed25519', namedCurve: 'NODE-ED25519' },
      false,
      ['verify']
    );
    const sig = b64(j.signature.sig_b64);
    const hash = Uint8Array.from(j.hash.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
    const ok = await (globalThis.crypto || window.crypto).subtle.verify(
      { name: 'Ed25519' },
      pubKey,
      sig,
      hash
    );
    return Boolean(ok);
  } catch {
    return false;
  }
}

export default function JournalPage({ params }) {
  const resolvedParams = typeof params?.then === 'function' ? use(params) : params;
  const roomId = decodeURIComponent(resolvedParams?.roomId || '');
  const [items, setItems] = useState([]);
  const [ver, setVer] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${apiBase()}/journal/history?room_id=${encodeURIComponent(roomId)}`);
        const j = await r.json().catch(() => ({}));
        const journals = Array.isArray(j?.journals) ? j.journals : [];
        if (!cancelled) setItems(journals);
        // async verify
        Promise.all(journals.map(verifySig)).then((vals) => {
          const map = {};
          for (let i = 0; i < journals.length; i++) map[journals[i].round_idx ?? i] = vals[i];
          if (!cancelled) setVer(map);
        });
      } catch {
        /* ignore */
      }
    }
    if (roomId) load();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Journal History</h1>
        <Button variant="ghost" asChild>
          <Link href={`/room/${encodeURIComponent(roomId)}`}>Back to Room</Link>
        </Button>
      </header>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="text-sm text-muted">Room ID</div>
          <div className="font-mono text-sm break-all">{roomId}</div>
          {items.length === 0 ? (
            <p className="text-sm text-muted">No journals yet.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((j) => (
                <li key={j.round_idx} className="rounded border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-sm">Round</div>
                      <div className="text-xl font-semibold">{j.round_idx}</div>
                    </div>
                    <div className="text-right space-y-1">
                      <div className="text-sm">Hash</div>
                      <div className="font-mono text-[11px] break-all">{j.hash}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Badge variant={ver[j.round_idx] ? 'success' : 'destructive'}>
                      {ver[j.round_idx] ? 'signature: ok' : 'signature: fail'}
                    </Badge>
                    <a
                      className="underline text-[color:var(--teal)]"
                      href={`${apiBase()}/journal?room_id=${encodeURIComponent(roomId)}&idx=${j.round_idx}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View JSON →
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
