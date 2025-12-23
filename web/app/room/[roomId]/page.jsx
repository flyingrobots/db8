'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { isValidJournalEventPayload, getLastSeenJournalIdx } from '@/lib/validateSse';

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
  const [citations, setCitations] = useState([
    { url: '', title: '' },
    { url: '', title: '' }
  ]);
  const [participant, setParticipant] = useState('');
  const [jwt, setJwt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [hasNewJournal, setHasNewJournal] = useState(false);
  const [verifyRows, setVerifyRows] = useState([]);
  const lastAckIdxRef = useRef(-1);
  const latestIdxRef = useRef(-1);
  const timerRef = useRef(null);
  const esRef = useRef(null);
  const lastNonceRef = useRef('');

  const [role, setRole] = useState('');
  const [verifying, setVerifying] = useState(null); // submission object
  const [flagging, setFlagging] = useState(null); // submission object
  const [showContinueVote, setShowContinueVote] = useState(false);
  const [showFinalVote, setShowFinalVote] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [researchUrl, setResearchUrl] = useState('');
  const [researchResults, setResearchResults] = useState([]); // { url, snapshot }
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
      es.addEventListener('verdict', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.room_id !== roomId) return;
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

  // Fetch verification summary
  useEffect(() => {
    const rid = state?.round?.round_id;
    if (!rid) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${apiBase()}/verify/summary?round_id=${encodeURIComponent(rid)}`);
        const j = await r.json().catch(() => ({}));
        if (!cancelled && j.ok) setVerifyRows(j.rows || []);
      } catch {
        /* ignore */
      }
    }
    load();
    const iv = setInterval(load, 10000);
    return () => {
      clearInterval(iv);
      cancelled = true;
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

  async function onFetchResearch() {
    if (!researchUrl) return;
    setActionBusy(true);
    try {
      const r = await fetch(`${apiBase()}/rpc/research.fetch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId,
          round_id: state.round.round_id,
          participant_id: participant,
          url: researchUrl
        })
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        setResearchResults((prev) => [j, ...prev.filter((x) => x.url_hash !== j.url_hash)]);
        setResearchUrl('');
      } else {
        window.alert(j.error || 'Fetch failed');
      }
    } catch (err) {
      window.alert(String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    setSuccess('');
    const roundId = state.round.round_id;

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
    const clientNonce = issued || window.crypto.randomUUID();
    lastNonceRef.current = clientNonce;

    const payload = {
      room_id: roomId,
      round_id: roundId,
      author_id: participant,
      phase: 'submit',
      deadline_unix: state.round.submit_deadline_unix || 0,
      content: content || '',
      claims: [{ id: 'c1', text: 'Main Argument', support: [{ kind: 'logic', ref: 'analysis' }] }],
      citations: citations.filter((c) => c.url),
      client_nonce: clientNonce
    };
    try {
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
    const claim_id = form.get('claim_id');
    setActionBusy(true);
    try {
      const payload = {
        round_id: state.round.round_id,
        reporter_id: participant,
        submission_id: verifying.submission_id,
        verdict,
        rationale,
        claim_id: claim_id || undefined,
        client_nonce: window.crypto.randomUUID()
      };
      const r = await fetch(`${apiBase()}/rpc/verify.submit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (r.ok) setVerifying(null);
      else window.alert('Verify failed');
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
      if (r.ok) setFlagging(null);
      else window.alert('Flag failed');
    } catch (err) {
      window.alert(String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onContinueVote(choice) {
    setActionBusy(true);
    try {
      const r = await fetch(`${apiBase()}/rpc/vote.continue`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
        },
        body: JSON.stringify({
          room_id: roomId,
          round_id: state.round.round_id,
          voter_id: participant,
          choice,
          client_nonce: window.crypto.randomUUID()
        })
      });
      if (r.ok) setShowContinueVote(false);
      else window.alert('Vote failed');
    } catch (err) {
      window.alert(String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onFinalVote(approval, ranking = []) {
    setActionBusy(true);
    try {
      const r = await fetch(`${apiBase()}/rpc/vote.final`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
        },
        body: JSON.stringify({
          round_id: state.round.round_id,
          voter_id: participant,
          approval,
          ranking,
          client_nonce: window.crypto.randomUUID()
        })
      });
      if (r.ok) setShowFinalVote(false);
      else window.alert('Final vote failed');
    } catch (err) {
      window.alert(String(err));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6 flex flex-col md:flex-row gap-6 items-start">
      <div className={`flex-1 space-y-6 w-full ${showResearch ? 'md:w-2/3' : ''}`}>
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            Room
            <Button
              variant="link"
              size="sm"
              className="text-xs text-muted-foreground p-0 h-auto"
              asChild
            >
              <Link href={`/room/${encodeURIComponent(roomId)}/provenance`}>View Chain →</Link>
            </Button>
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowResearch(!showResearch)}>
              {showResearch ? 'Hide Research' : 'Research Tools'}
            </Button>
            {state?.round?.phase === 'published' && (
              <Button size="sm" onClick={() => setShowContinueVote(true)}>
                Vote to Continue
              </Button>
            )}
            {state?.round?.phase === 'final' && (
              <Button size="sm" onClick={() => setShowFinalVote(true)}>
                Final Vote
              </Button>
            )}
            {role && <Badge variant="outline">{role}</Badge>}
            <Button variant="ghost" asChild>
              <Link href="/">Back</Link>
            </Button>
          </div>
        </header>

        <Card>
          <CardContent className="p-5 space-y-2">
            <div className="text-sm text-muted-foreground font-mono truncate">{roomId}</div>
            <div className="flex items-center justify-between mt-2">
              <div>
                <div className="text-sm text-muted-foreground uppercase tracking-wider font-bold">
                  Phase
                </div>
                <div className="text-xl font-semibold">{state?.round?.phase || '-'}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground uppercase tracking-wider font-bold">
                  Countdown
                </div>
                <div className="text-2xl font-mono">{mmss(remaining)}</div>
              </div>
            </div>
            {state?.round?.continue_tally && (
              <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                <span className="text-xs font-medium">Continue Tally:</span>
                <Badge className="bg-green-600">yes {state.round.continue_tally.yes}</Badge>
                <Badge variant="secondary">no {state.round.continue_tally.no}</Badge>
              </div>
            )}
            {state?.round?.final_tally && (
              <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                <span className="text-xs font-medium">Final Approval:</span>
                <Badge className="bg-green-600">approves {state.round.final_tally.approves}</Badge>
                <Badge variant="destructive">rejects {state.round.final_tally.rejects}</Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {state?.round?.phase === 'submit' ? (
          <Card className="border-primary/20 shadow-lg">
            <CardContent className="p-5 space-y-4">
              <div className="text-lg font-bold">Draft Submission</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="border border-border rounded px-2 py-1 bg-background text-sm"
                  placeholder="Participant ID"
                  value={participant}
                  onChange={(e) => setParticipant(e.target.value)}
                />
                <input
                  className="border border-border rounded px-2 py-1 bg-background text-sm"
                  placeholder="JWT (optional)"
                  value={jwt}
                  onChange={(e) => setJwt(e.target.value)}
                />
              </div>
              <textarea
                className="w-full min-h-[160px] border border-border rounded px-3 py-2 bg-background text-sm leading-relaxed"
                placeholder="Write your argument..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />

              <div className="space-y-2 bg-secondary/10 p-3 rounded">
                <div className="text-sm font-bold flex items-center justify-between">
                  <span>Citations (Min 2)</span>
                  {citations.filter((c) => c.url).length >= 2 ? (
                    <Badge className="bg-green-600 text-[10px]">Ready</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-orange-600">
                      Required
                    </Badge>
                  )}
                </div>
                {citations.map((cite, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="flex-1 border border-border rounded px-2 py-1 bg-background text-xs"
                      placeholder="URL"
                      value={cite.url}
                      onChange={(e) => {
                        const next = [...citations];
                        next[i].url = e.target.value;
                        setCitations(next);
                      }}
                    />
                    <input
                      className="w-1/3 border border-border rounded px-2 py-1 bg-background text-xs"
                      placeholder="Title"
                      value={cite.title}
                      onChange={(e) => {
                        const next = [...citations];
                        next[i].title = e.target.value;
                        setCitations(next);
                      }}
                    />
                    {citations.length > 2 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => setCitations(citations.filter((_, idx) => idx !== i))}
                      >
                        ×
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setCitations([...citations, { url: '', title: '' }])}
                >
                  + Add another
                </Button>
              </div>

              {error && (
                <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                  {error}
                </div>
              )}
              {success && (
                <div className="text-xs text-green-600 bg-green-600/10 p-2 rounded">{success}</div>
              )}
              <div className="flex justify-end pt-2">
                <Button
                  disabled={
                    busy || !canSubmit || !content || citations.filter((c) => c.url).length < 2
                  }
                  onClick={onSubmit}
                >
                  {busy ? 'Submitting...' : 'Submit Draft'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold">Transcript</div>
              <Badge variant="outline">{transcript.length} entries</Badge>
            </div>
            <Link
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
              href={`/journal/${encodeURIComponent(roomId)}`}
            >
              View journal history →{' '}
              {hasNewJournal && <Badge className="bg-green-600 h-4 scale-75">NEW</Badge>}
            </Link>
            {transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No submissions yet.</p>
            ) : (
              <ul className="space-y-4">
                {transcript.map((entry) => (
                  <li
                    key={entry.submission_id}
                    className="rounded-lg border border-border bg-card p-4 space-y-2 shadow-sm"
                  >
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                      <span>{entry.author_anon_name || entry.author_id.slice(0, 8)}</span>
                      {entry.submitted_at && (
                        <span>{new Date(entry.submitted_at * 1000).toLocaleTimeString()}</span>
                      )}
                    </div>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                      {entry.content}
                    </p>
                    <div className="flex items-center justify-between pt-2 border-t border-border/50">
                      <code className="text-[9px] text-muted-foreground">
                        SHA256: {entry.canonical_sha256.slice(0, 16)}...
                      </code>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10px]"
                          onClick={() => setFlagging(entry)}
                        >
                          Flag
                        </Button>
                        {(role === 'judge' || role === 'host') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] text-primary border-primary/50"
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
              <div className="text-lg font-bold">Verification Summary</div>
              <Badge variant="outline">{verifyRows.length} verdicts</Badge>
            </div>
            {verifyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-4">
                No verification verdicts yet.
              </p>
            ) : (
              <div className="space-y-6">
                {Object.entries(
                  verifyRows.reduce((acc, row) => {
                    if (!acc[row.submission_id])
                      acc[row.submission_id] = { main: null, claims: [] };
                    if (!row.claim_id) acc[row.submission_id].main = row;
                    else acc[row.submission_id].claims.push(row);
                    return acc;
                  }, {})
                ).map(([subId, group]) => (
                  <div
                    key={subId}
                    className="space-y-3 border-b border-border/50 pb-4 last:border-0"
                  >
                    <div className="flex items-center justify-between text-xs font-bold font-mono text-muted-foreground">
                      <span>SUB: {subId.slice(0, 8)}</span>
                      {group.main && <ConfidenceBadge row={group.main} />}
                    </div>
                    {group.main && <VerdictBar row={group.main} />}
                    {group.claims.map((claim, i) => (
                      <div key={i} className="pl-4 border-l-2 border-primary/20 space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase">
                          <span>Claim: {claim.claim_id}</span>
                          <ConfidenceBadge row={claim} size="sm" />
                        </div>
                        <VerdictBar row={claim} size="sm" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showResearch && (
        <aside className="w-full md:w-1/3 space-y-6 sticky top-6 h-full max-h-[90vh] overflow-y-auto pr-2 custom-scrollbar">
          <Card className="border-teal-600/30 shadow-xl bg-teal-50/5 dark:bg-teal-900/5">
            <CardContent className="p-5 space-y-4">
              <div className="text-lg font-bold text-teal-600">Research Fetcher</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-teal-600/30 rounded px-2 py-1 bg-background text-sm"
                  placeholder="Paste URL to snapshot..."
                  value={researchUrl}
                  onChange={(e) => setResearchUrl(e.target.value)}
                />
                <Button
                  size="sm"
                  className="bg-teal-600 hover:bg-teal-700"
                  onClick={onFetchResearch}
                  disabled={actionBusy}
                >
                  {actionBusy ? '...' : 'Fetch'}
                </Button>
              </div>
              <div className="space-y-4">
                <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">
                  Results
                </div>
                {researchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-8">
                    Fetched snapshots will appear here.
                  </p>
                ) : (
                  researchResults.map((res, i) => (
                    <Card
                      key={i}
                      className="bg-background border-teal-600/20 shadow-sm overflow-hidden group"
                    >
                      <div className="p-3 space-y-2">
                        <div className="text-xs font-bold text-teal-700 line-clamp-1">
                          {res.snapshot.title}
                        </div>
                        <p className="text-[10px] leading-relaxed text-muted-foreground line-clamp-3">
                          {res.snapshot.excerpt}
                        </p>
                        <div className="flex justify-between items-center pt-1">
                          <span className="text-[9px] text-muted-foreground underline truncate max-w-[120px]">
                            {new URL(res.url).hostname}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] text-teal-600 font-bold"
                            onClick={() => {
                              const next = [...citations];
                              const emptyIdx = next.findIndex((c) => !c.url);
                              if (emptyIdx !== -1) {
                                next[emptyIdx] = {
                                  url: res.snapshot.canonical_url,
                                  title: res.snapshot.title
                                };
                              } else {
                                next.push({
                                  url: res.snapshot.canonical_url,
                                  title: res.snapshot.title
                                });
                              }
                              setCitations(next);
                            }}
                          >
                            + Cite
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </aside>
      )}

      {/* Dialogs ... (verifying, flagging, continueVote, finalVote) */}
      {verifying && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-lg font-bold">Verify Submission</h3>
              <form onSubmit={onVerifySubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-black uppercase text-muted-foreground">
                    Claim
                  </label>
                  <select
                    name="claim_id"
                    className="w-full mt-1 border rounded p-2 bg-background text-sm"
                  >
                    <option value="">Full Submission</option>
                    {(verifying.claims || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}: {c.text.slice(0, 30)}...
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black uppercase text-muted-foreground">
                    Verdict
                  </label>
                  <select
                    name="verdict"
                    className="w-full mt-1 border rounded p-2 bg-background text-sm"
                  >
                    <option value="true">True</option>
                    <option value="false">False</option>
                    <option value="unclear">Unclear</option>
                    <option value="needs_work">Needs Work</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black uppercase text-muted-foreground">
                    Rationale
                  </label>
                  <textarea
                    name="rationale"
                    required
                    className="w-full mt-1 border rounded p-2 bg-background text-sm min-h-[100px]"
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-lg font-bold">Flag Submission</h3>
              <form onSubmit={onFlagSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-black uppercase text-muted-foreground">
                    Reason
                  </label>
                  <textarea
                    name="reason"
                    required
                    className="w-full mt-1 border rounded p-2 bg-background text-sm min-h-[80px]"
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

      {showContinueVote && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl text-center">
            <CardContent className="p-8 space-y-6">
              <h3 className="text-xl font-bold">Round Complete</h3>
              <p className="text-muted-foreground">Should the debate continue to the next round?</p>
              <div className="flex justify-center gap-4">
                <Button
                  variant="outline"
                  className="w-32"
                  onClick={() => onContinueVote('end')}
                  disabled={actionBusy}
                >
                  End Debate
                </Button>
                <Button
                  className="w-32"
                  onClick={() => onContinueVote('continue')}
                  disabled={actionBusy}
                >
                  Continue
                </Button>
              </div>
              <Button
                variant="ghost"
                className="text-xs text-muted-foreground"
                onClick={() => setShowContinueVote(false)}
              >
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {showFinalVote && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl">
            <CardContent className="p-8 space-y-6">
              <h3 className="text-xl font-bold">Final Approval</h3>
              <p className="text-muted-foreground">
                Do you approve the results/conclusions of this debate?
              </p>
              <div className="flex justify-center gap-4">
                <Button
                  variant="destructive"
                  className="w-32"
                  onClick={() => onFinalVote(false)}
                  disabled={actionBusy}
                >
                  Reject
                </Button>
                <Button
                  className="w-32 bg-green-600 hover:bg-green-700"
                  onClick={() => onFinalVote(true)}
                  disabled={actionBusy}
                >
                  Approve
                </Button>
              </div>
              <Button
                variant="ghost"
                className="text-xs text-muted-foreground w-full"
                onClick={() => setShowFinalVote(false)}
              >
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}

function calculateScore(r) {
  if (!r || r.total === 0) return 0.5;
  return (r.true_count - r.false_count + r.total) / (2 * r.total);
}

function ConfidenceBadge({ row, size = 'default' }) {
  const score = calculateScore(row);
  let color = 'bg-slate-500';
  let label = 'Neutral';
  if (score >= 0.75) {
    color = 'bg-emerald-500 text-white';
    label = 'Verified';
  } else if (score >= 0.6) {
    color = 'bg-blue-500 text-white';
    label = 'Likely True';
  } else if (score <= 0.25) {
    color = 'bg-rose-500 text-white';
    label = 'False';
  } else if (score <= 0.4) {
    color = 'bg-amber-500 text-white';
    label = 'Dubious';
  }
  const classes = size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5';
  return (
    <span className={`rounded-full font-black uppercase tracking-tighter ${classes} ${color}`}>
      {label} ({Math.round(score * 100)}%)
    </span>
  );
}

function VerdictBar({ row, size = 'default' }) {
  const total = row.total || 1;
  const getPct = (n) => `${(n / total) * 100}%`;
  const h = size === 'sm' ? 'h-1' : 'h-2';
  return (
    <div className={`flex w-full ${h} rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800`}>
      <div
        style={{ width: getPct(row.true_count) }}
        className="bg-emerald-500"
        title={`True: ${row.true_count}`}
      />
      <div
        style={{ width: getPct(row.false_count) }}
        className="bg-rose-500"
        title={`False: ${row.false_count}`}
      />
      <div
        style={{ width: getPct(row.unclear_count) }}
        className="bg-slate-400"
        title={`Unclear: ${row.unclear_count}`}
      />
      <div
        style={{ width: getPct(row.needs_work_count) }}
        className="bg-amber-400"
        title={`Needs Work: ${row.needs_work_count}`}
      />
    </div>
  );
}
