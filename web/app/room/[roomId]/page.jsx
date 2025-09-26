'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { z } from 'zod';

function apiBase() {
  const u = process.env.NEXT_PUBLIC_DB8_API_URL || 'http://localhost:3000';
  return u.replace(/\/$/, '');
}

function isUUID(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

function mmss(secRemaining) {
  const s = Math.max(0, secRemaining);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function RoomPage({ params }) {
  const roomId = decodeURIComponent(params.roomId || '');
  const [state, setState] = useState(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [content, setContent] = useState('');
  const [participant, setParticipant] = useState('');
  const [jwt, setJwt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const timerRef = useRef(null);
  const esRef = useRef(null);

  // Fetch snapshot
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${apiBase()}/state?room_id=${encodeURIComponent(roomId)}`);
        const j = await r.json().catch(() => ({}));
        if (!cancelled) setState(j);
      } catch {
        void 0;
      }
    }
    if (roomId) load();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // SSE countdown subscription
  useEffect(() => {
    if (!roomId) return;
    try {
      const es = new window.EventSource(
        `${apiBase()}/events?room_id=${encodeURIComponent(roomId)}`
      );
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.ends_unix) setNow(Math.floor(Date.now() / 1000));
        } catch {
          void 0;
        }
      };
      es.onerror = () => {
        try {
          es.close();
        } catch {
          void 0;
        }
      };
    } catch {
      void 0;
    }
    timerRef.current = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (esRef.current)
        try {
          esRef.current.close();
        } catch {
          void 0;
        }
    };
  }, [roomId]);

  const endsAt = useMemo(() => {
    const rnd = state?.round || {};
    if (rnd.phase === 'submit' && rnd.submit_deadline_unix) return rnd.submit_deadline_unix;
    if (rnd.phase === 'published' && rnd.continue_vote_close_unix)
      return rnd.continue_vote_close_unix;
    return 0;
  }, [state]);

  const remaining = Math.max(0, (endsAt || 0) - now);
  const canSubmit =
    state?.ok && state?.round?.phase === 'submit' && isUUID(roomId) && isUUID(participant);

  // Persist small fields locally for convenience
  useEffect(() => {
    try {
      const p = window.localStorage.getItem('db8.participant') || '';
      const t = window.localStorage.getItem('db8.jwt') || '';
      setParticipant(p);
      setJwt(t);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('db8.participant', participant || '');
    } catch {
      /* ignore */
    }
  }, [participant]);
  useEffect(() => {
    try {
      window.localStorage.setItem('db8.jwt', jwt || '');
    } catch {
      /* ignore */
    }
  }, [jwt]);

  const SubmissionIn = useMemo(
    () =>
      z.object({
        room_id: z.string().uuid(),
        round_id: z.string().uuid(),
        author_id: z.string().uuid(),
        phase: z.enum(['OPENING', 'ARGUMENT', 'FINAL']),
        deadline_unix: z.number().int(),
        content: z.string().min(1).max(4000),
        claims: z
          .array(
            z.object({
              id: z.string(),
              text: z.string().min(0),
              support: z
                .array(z.object({ kind: z.enum(['citation', 'logic', 'data']), ref: z.string() }))
                .min(1)
            })
          )
          .min(1)
          .max(5),
        citations: z
          .array(z.object({ url: z.string().url(), title: z.string().optional() }))
          .min(2),
        client_nonce: z.string().min(8)
      }),
    []
  );

  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    setSuccess('');
    const payload = {
      room_id: roomId,
      round_id: '00000000-0000-0000-0000-000000000002',
      author_id: participant,
      phase: 'OPENING',
      deadline_unix: state.round.submit_deadline_unix || 0,
      content: content || '',
      claims: [
        {
          id: 'c1',
          text: '',
          support: [{ kind: 'citation', ref: 'a' }]
        }
      ],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce:
        typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now())
    };
    try {
      SubmissionIn.parse(payload);
      const r = await fetch(`${apiBase()}/rpc/submission.create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) setSuccess(`Submitted: ${j.submission_id}`);
      else setError(j?.error || `Server error ${r.status}`);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Room</h1>
        <Button variant="ghost" asChild>
          <Link href="/">Back</Link>
        </Button>
      </header>

      <Card>
        <CardContent className="p-5 space-y-2">
          <div className="text-sm text-muted">Room ID</div>
          <div className="font-mono text-sm break-all">{roomId}</div>
          <div className="flex items-center justify-between mt-4">
            <div>
              <div className="text-sm text-muted">Phase</div>
              <div className="text-xl font-semibold">{state?.round?.phase || '-'}</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted">Server Countdown</div>
              <div className="text-2xl font-mono">{mmss(remaining)}</div>
            </div>
          </div>
          {state?.round?.continue_tally && (
            <div className="mt-3 flex items-center gap-3">
              <Badge variant="success">yes {state.round.continue_tally.yes}</Badge>
              <Badge>no {state.round.continue_tally.no}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {state?.round?.phase === 'submit' ? (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="text-lg font-semibold">Submit</div>
            {!isUUID(roomId) && (
              <div className="text-sm text-red-600">
                This demo submit requires a UUID-like room id.
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-sm text-muted mb-1">Participant ID (uuid)</div>
                <input
                  className="w-full border border-border rounded px-2 py-1 bg-background"
                  placeholder="00000000-0000-0000-0000-0000000000ab"
                  value={participant}
                  onChange={(e) => setParticipant(e.target.value)}
                />
              </div>
              <div>
                <div className="text-sm text-muted mb-1">JWT (optional)</div>
                <input
                  className="w-full border border-border rounded px-2 py-1 bg-background"
                  placeholder="Bearer token"
                  value={jwt}
                  onChange={(e) => setJwt(e.target.value)}
                />
              </div>
            </div>
            <div>
              <div className="text-sm text-muted mb-1">Content</div>
              <textarea
                className="w-full min-h-32 border border-border rounded px-2 py-1 bg-background"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            {success && <div className="text-sm text-green-600">{success}</div>}
            <div className="flex justify-end">
              <Button disabled={busy || !canSubmit || !content} onClick={onSubmit}>
                {busy ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5 space-y-2">
            <div className="text-lg font-semibold">Transcript</div>
            <div className="text-sm text-muted">Stub — submissions listing to be wired later.</div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
