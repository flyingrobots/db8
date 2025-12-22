'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { z } from 'zod';
import {
  isValidJournalEventPayload,
  getLastSeenJournalIdx,
  setLastSeenJournalIdx
} from '@/lib/validateSse';

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
  const resolvedParams = typeof params?.then === 'function' ? use(params) : params;
  const roomId = decodeURIComponent(resolvedParams?.roomId || '');
  const [state, setState] = useState(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [content, setContent] = useState('');
  const [participant, setParticipant] = useState('');
  const [jwt, setJwt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [hasNewJournal, setHasNewJournal] = useState(false);
  const [verifyRows, setVerifyRows] = useState([]);
  const [verifyError, setVerifyError] = useState('');
  const lastAckIdxRef = useRef(-1);
  const latestIdxRef = useRef(-1);
  const timerRef = useRef(null);
  const esRef = useRef(null);
  const lastNonceRef = useRef('');

  const [role, setRole] = useState('');
  const [verifying, setVerifying] = useState(null); // submission object
  const [flagging, setFlagging] = useState(null); // submission object
  const [actionBusy, setActionBusy] = useState(false);

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

  // Fetch role
  useEffect(() => {
    if (!participant || !roomId) return;
    async function loadRole() {
      try {
        const r = await fetch(
          `${apiBase()}/rpc/participant?room_id=${encodeURIComponent(roomId)}&id=${encodeURIComponent(participant)}`
        );
        const j = await r.json().catch(() => ({}));
        if (j.ok && j.role) setRole(j.role);
      } catch {
        /* ignore */
      }
    }
    loadRole();
  }, [participant, roomId]);

  // Initialize last acknowledged journal idx from sessionStorage
  useEffect(() => {
    try {
      lastAckIdxRef.current = getLastSeenJournalIdx(roomId);
    } catch {
      lastAckIdxRef.current = -1;
    }
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
      es.addEventListener('journal', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (!isValidJournalEventPayload(roomId, d)) return;
          latestIdxRef.current = d.idx;
          if (d.idx > (lastAckIdxRef.current | 0)) setHasNewJournal(true);
        } catch {
          /* ignore */
        }
      });
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
  const transcript = Array.isArray(state?.round?.transcript) ? state.round.transcript : [];

  // Fetch verification summary (read-only) when round_id is known with backoff + shape validation
  useEffect(() => {
    const rid = state?.round?.round_id;
    if (!rid) {
      setVerifyRows([]);
      setVerifyError('');
      return;
    }
    let cancelled = false;
    let delay = 5000;
    let lastSig = '';
    let controller;
    const Row = z.object({
      submission_id: z.string().uuid(),
      claim_id: z.string().nullable().optional(),
      true_count: z.number().int(),
      false_count: z.number().int(),
      unclear_count: z.number().int(),
      needs_work_count: z.number().int(),
      total: z.number().int()
    });
    const Rows = z.array(Row);
    async function loop() {
      while (!cancelled) {
        controller = new globalThis.AbortController();
        let aborted = false;
        try {
          const r = await fetch(`${apiBase()}/verify/summary?round_id=${encodeURIComponent(rid)}`, {
            signal: controller.signal
          });
          const j = await r.json().catch(() => ({}));
          if (cancelled) {
            break;
          }
          if (r.ok && j?.ok && Array.isArray(j.rows)) {
            const parsed = Rows.safeParse(j.rows);
            if (parsed.success) {
              const sig = JSON.stringify(parsed.data);
              if (sig !== lastSig) {
                lastSig = sig;
                if (!cancelled && !controller.signal.aborted) {
                  setVerifyRows(parsed.data);
                }
              }
              if (!cancelled && !controller.signal.aborted) {
                setVerifyError('');
              }
              delay = 5000; // reset backoff on success
            } else {
              lastSig = '';
              if (!cancelled && !controller.signal.aborted) {
                setVerifyRows([]);
                setVerifyError('Invalid verification data');
              }
              delay = Math.min(30000, delay * 2);
            }
          } else {
            lastSig = '';
            if (!cancelled && !controller.signal.aborted) {
              setVerifyRows([]);
              setVerifyError(j?.error || `HTTP ${r.status}`);
            }
            delay = Math.min(30000, delay * 2);
          }
        } catch (e) {
          aborted =
            controller?.signal?.aborted ||
            e?.name === 'AbortError' ||
            (typeof e?.message === 'string' && e.message.toLowerCase().includes('abort'));
          if (!aborted && !cancelled) {
            setVerifyRows([]);
            setVerifyError(String(e?.message || e));
            lastSig = '';
            delay = Math.min(30000, delay * 2);
          }
        } finally {
          controller = null;
        }
        if (cancelled || aborted) {
          break;
        }
        await new Promise((res) => globalThis.setTimeout(res, delay));
      }
    }
    loop();
    return () => {
      cancelled = true;
      controller?.abort();
      setVerifyRows([]);
      setVerifyError('');
    };
  }, [state?.round?.round_id]);

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
        phase: z.enum(['submit', 'published', 'final']),
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
    const roundId = '00000000-0000-0000-0000-000000000002';
    // Try to obtain a server-issued nonce first (works for both DB + fallback)
    // If issuance fails, fall back to a random nonce (may be rejected when enforcement is enabled)
    async function issueNonce() {
      try {
        const r = await fetch(`${apiBase()}/rpc/nonce.issue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ round_id: roundId, author_id: participant, ttl_sec: 120 })
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok && typeof j?.nonce === 'string') return j.nonce;
        return '';
      } catch {
        return '';
      }
    }

    const issued = await issueNonce();
    const clientNonce =
      issued ||
      (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : String(Date.now()));
    lastNonceRef.current = clientNonce;

    const payload = {
      room_id: roomId,
      round_id: roundId,
      author_id: participant,
      phase: 'submit',
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
      client_nonce: clientNonce
    };
    try {
      SubmissionIn.parse(payload);
      const r = await fetch(`${apiBase()}/rpc/submission.create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
          'x-db8-client-nonce': clientNonce
        },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) setSuccess(`Submitted: ${j.submission_id}`);
      else if (j?.error === 'invalid_nonce')
        setError('Submit failed: server requires an issued nonce. Please try again.');
      else setError(j?.error || `Server error ${r.status}`);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onVerifySubmit(e) {
    e.preventDefault();
    if (!verifying) return;
    const form = new window.FormData(e.target);
    const verdict = form.get('verdict');
    const rationale = form.get('rationale');
    setActionBusy(true);
    try {
      const clientNonce = lastNonceRef.current || String(Date.now()); // simplified
      const payload = {
        round_id: '00000000-0000-0000-0000-000000000002', // Ideally from state.round.round_id
        reporter_id: participant,
        submission_id: verifying.submission_id,
        verdict,
        rationale,
        client_nonce: clientNonce
      };
      const r = await fetch(`${apiBase()}/rpc/verify.submit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (r.ok) {
        setVerifying(null);
        // Trigger verification refresh logic here if possible,
        // effectively handled by the polling effect eventually
      } else {
        window.alert('Verify failed');
      }
    } catch (err) {
      window.alert(String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onFlagSubmit(e) {
    e.preventDefault();
    if (!flagging) return;
    const form = new window.FormData(e.target);
    const reason = form.get('reason');
    setActionBusy(true);
    try {
      const payload = {
        submission_id: flagging.submission_id,
        reporter_id: participant,
        reporter_role: role || 'participant',
        reason
      };
      const r = await fetch(`${apiBase()}/rpc/submission.flag`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (r.ok) {
        setFlagging(null);
        // Ideally trigger state refresh to update flag counts
      } else {
        window.alert('Flag failed');
      }
    } catch (err) {
      window.alert(String(err));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Room</h1>
        <div className="flex items-center gap-2">
          {role && <Badge variant="outline">{role}</Badge>}
          <Button variant="ghost" asChild>
            <Link href="/">Back</Link>
          </Button>
        </div>
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
      ) : null}

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold">Transcript</div>
            <Badge variant="outline">{transcript.length} entries</Badge>
          </div>
          <div className="text-sm flex items-center gap-3">
            <Link
              className="underline text-[color:var(--teal)]"
              href={`/journal/${encodeURIComponent(roomId)}`}
              onClick={() => {
                setHasNewJournal(false);
                const idx = latestIdxRef.current;
                if (Number.isInteger(idx) && idx >= 0) {
                  setLastSeenJournalIdx(roomId, idx);
                  lastAckIdxRef.current = idx;
                }
              }}
            >
              View journal history →
            </Link>
            {hasNewJournal && <Badge variant="success">New checkpoint</Badge>}
          </div>
          {transcript.length === 0 ? (
            <p className="text-sm text-muted">No submissions yet.</p>
          ) : (
            <ul className="space-y-3">
              {transcript.map((entry) => (
                <li
                  key={entry.submission_id}
                  className="rounded border border-border p-3 space-y-2 relative"
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
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[11px] text-muted-foreground font-mono">
                      sha256: {entry.canonical_sha256}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs px-2"
                        onClick={() => setFlagging(entry)}
                      >
                        Flag
                      </Button>
                      {(role === 'judge' || role === 'host') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2 text-[var(--primary)] border-[var(--primary)]"
                          onClick={() => setVerifying(entry)}
                        >
                          Verify
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold">Verification Summary</div>
            <Badge variant="outline">
              {Array.isArray(verifyRows) ? verifyRows.length : 0} verdicts
            </Badge>
          </div>
          {verifyError && <p className="text-sm text-red-600">{verifyError}</p>}
          {!verifyRows || verifyRows.length === 0 ? (
            <p className="text-sm text-muted">No verification verdicts yet.</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(
                verifyRows.reduce((acc, row) => {
                  if (!acc[row.submission_id]) acc[row.submission_id] = { main: null, claims: [] };
                  if (!row.claim_id) acc[row.submission_id].main = row;
                  else acc[row.submission_id].claims.push(row);
                  return acc;
                }, {})
              ).map(([subId, group]) => (
                <div
                  key={subId}
                  className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-mono text-muted-foreground">
                      {subId.slice(0, 8)}...
                    </div>
                    {group.main && <ConfidenceBadge row={group.main} />}
                  </div>

                  {/* If we have a main verdict, show details */}
                  {group.main && <VerdictBar row={group.main} />}

                  {/* Claims list */}
                  {group.claims.length > 0 && (
                    <div className="pl-4 mt-2 space-y-2 border-l-2 border-border/50">
                      {group.claims.map((claim, i) => (
                        <div key={i} className="text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-xs text-muted-foreground">
                              Claim: {claim.claim_id}
                            </span>
                            <ConfidenceBadge row={claim} size="sm" />
                          </div>
                          <VerdictBar row={claim} size="sm" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Overlays */}
      {verifying && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-lg font-semibold">Verify Submission</h3>
              <p className="text-xs font-mono text-muted-foreground break-all">
                {verifying.submission_id}
              </p>
              <form onSubmit={onVerifySubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Verdict</label>
                  <select name="verdict" className="w-full mt-1 border rounded p-2 bg-background">
                    <option value="true">True</option>
                    <option value="false">False</option>
                    <option value="unclear">Unclear</option>
                    <option value="needs_work">Needs Work</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Rationale</label>
                  <textarea
                    name="rationale"
                    required
                    className="w-full mt-1 border rounded p-2 bg-background min-h-[100px]"
                    placeholder="Explain your verdict..."
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setVerifying(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={actionBusy}>
                    {actionBusy ? 'Saving...' : 'Submit Verdict'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {flagging && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-lg font-semibold">Flag Submission</h3>
              <p className="text-xs font-mono text-muted-foreground break-all">
                {flagging.submission_id}
              </p>
              <form onSubmit={onFlagSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Reason</label>
                  <textarea
                    name="reason"
                    required
                    className="w-full mt-1 border rounded p-2 bg-background min-h-[80px]"
                    placeholder="Why are you flagging this?"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setFlagging(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" disabled={actionBusy}>
                    {actionBusy ? 'Flagging...' : 'Flag'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}

function calculateScore(r) {
  if (!r || r.total === 0) return 0.5;
  // (True - False + Total) / (2 * Total)
  // Range: 0 (all false) to 1 (all true). 0.5 is neutral/unclear.
  return (r.true_count - r.false_count + r.total) / (2 * r.total);
}

function ConfidenceBadge({ row, size = 'default' }) {
  const score = calculateScore(row);
  let color = 'bg-gray-500';
  let label = 'Neutral';

  if (score >= 0.75) {
    color = 'bg-[var(--success)] text-black';
    label = 'Verified';
  } else if (score >= 0.6) {
    color = 'bg-[var(--primary)] text-black';
    label = 'Likely True';
  } else if (score <= 0.25) {
    color = 'bg-[var(--secondary)] text-black';
    label = 'False';
  } else if (score <= 0.4) {
    color = 'bg-orange-400 text-black';
    label = 'Dubious';
  }

  const classes = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span className={`rounded-full font-bold ${classes} ${color}`}>
      {label} ({Math.round(score * 100)}%)
    </span>
  );
}

function VerdictBar({ row, size = 'default' }) {
  const total = row.total || 1;
  const getPct = (n) => `${(n / total) * 100}%`;
  const h = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div className={`flex w-full ${h} rounded-full overflow-hidden bg-secondary/20`}>
      <div
        style={{ width: getPct(row.true_count) }}
        className="bg-[var(--success)]"
        title={`True: ${row.true_count}`}
      />
      <div
        style={{ width: getPct(row.false_count) }}
        className="bg-[var(--secondary)]"
        title={`False: ${row.false_count}`}
      />
      <div
        style={{ width: getPct(row.unclear_count) }}
        className="bg-gray-400"
        title={`Unclear: ${row.unclear_count}`}
      />
      <div
        style={{ width: getPct(row.needs_work_count) }}
        className="bg-orange-300"
        title={`Needs Work: ${row.needs_work_count}`}
      />
    </div>
  );
}
