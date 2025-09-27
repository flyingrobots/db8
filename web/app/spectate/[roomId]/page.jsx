'use client';
import { use, useEffect, useState } from 'react';
import ThemeToggle from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export default function SpectatorPage({ params }) {
  const resolvedParams = typeof params?.then === 'function' ? use(params) : params;
  const roomId = resolvedParams?.roomId || 'demo';
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(
          `${process.env.NEXT_PUBLIC_DB8_API_URL || 'http://localhost:3000'}/state?room_id=${encodeURIComponent(roomId)}`
        );
        const j = await r.json().catch(() => ({}));
        if (!cancelled) setState(j);
      } catch {
        /* ignore */
      }
    }
    if (roomId) load();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const phase = state?.round?.phase || 'submit';
  const roundIdx = state?.round?.idx ?? '-';
  const tally = state?.round?.continue_tally || { yes: 0, no: 0 };
  const transcript = Array.isArray(state?.round?.transcript) ? state.round.transcript : [];
  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Room {roomId}</h1>
          <p className="text-muted">Topic: Should open models outpace closed?</p>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </header>

      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant={phase === 'published' ? 'success' : 'default'}>Phase: {phase}</Badge>
            <Badge>Round {roundIdx}</Badge>
            <Badge variant="outline">yes {tally.yes}</Badge>
            <Badge variant="outline">no {tally.no}</Badge>
          </div>
          <div className="font-mono text-lg">--s</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold">Transcript</div>
            <Badge variant="outline">{transcript.length} entries</Badge>
          </div>
          {transcript.length === 0 ? (
            <p className="text-sm text-muted">No submissions yet.</p>
          ) : (
            <ul className="space-y-3">
              {transcript.map((entry) => (
                <li
                  key={entry.submission_id}
                  className="rounded border border-border p-3 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono text-[11px]">{entry.author_id}</span>
                    {entry.submitted_at ? (
                      <time dateTime={new Date(entry.submitted_at * 1000).toISOString()}>
                        {new Date(entry.submitted_at * 1000).toLocaleTimeString()}
                      </time>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-line text-sm leading-relaxed">{entry.content}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    sha256: {entry.canonical_sha256}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
