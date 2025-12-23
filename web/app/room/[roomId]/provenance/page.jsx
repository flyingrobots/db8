'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, Link as LinkIcon, ShieldCheck } from 'lucide-react';

function apiBase() {
  const u = process.env.NEXT_PUBLIC_DB8_API_URL || 'http://localhost:3000';
  return u.replace(/\/$/, '');
}

export default function ProvenanceExplorer({ params }) {
  const resolvedParams = use(params);
  const roomId = decodeURIComponent(resolvedParams?.roomId || '');
  const [journals, setJournals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch(`${apiBase()}/journal/history?room_id=${encodeURIComponent(roomId)}`);
        const j = await r.json().catch(() => ({}));
        if (j.ok) setJournals(j.journals || []);
        else setError(j.error || 'Failed to load journals');
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    if (roomId) load();
  }, [roomId]);

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tighter uppercase flex items-center gap-2">
            <ShieldCheck className="w-8 h-8 text-emerald-500" />
            Provenance Explorer
          </h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">Room: {roomId}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/room/${encodeURIComponent(roomId)}`}>Return to Room</Link>
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Verifying Chain...
          </p>
        </div>
      ) : error ? (
        <Card className="border-rose-500/50 bg-rose-500/5">
          <CardContent className="p-6 flex items-center gap-4 text-rose-600">
            <AlertTriangle />
            <p className="font-bold">{error}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="relative space-y-6">
          {/* Vertical Line */}
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-800 -z-10" />

          {journals.length === 0 ? (
            <p className="text-center py-20 text-muted-foreground italic">
              No journals found for this room yet.
            </p>
          ) : (
            journals.map((journal, i) => (
              <JournalNode
                key={journal.hash}
                journal={journal}
                isLast={i === journals.length - 1}
                isFirst={i === 0}
              />
            ))
          )}
        </div>
      )}
    </main>
  );
}

function JournalNode({ journal, isLast }) {
  const [expanded, setExpanded] = useState(isLast);
  const core = journal.core || {};
  const sig = journal.signature || {};

  return (
    <div className="flex gap-6 items-start group">
      {/* Node Bullet */}
      <div className={`mt-2 w-16 flex flex-col items-center justify-center`}>
        <div
          className={`w-4 h-4 rounded-full border-2 transition-all ${isLast ? 'bg-emerald-500 border-emerald-500 scale-125 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-background border-slate-400'}`}
        />
        <span className="text-[10px] font-black mt-2 text-muted-foreground uppercase tracking-tighter">
          R{core.idx}
        </span>
      </div>

      <Card
        className={`flex-1 transition-all ${expanded ? 'border-emerald-500/30 ring-1 ring-emerald-500/10' : 'hover:border-slate-400 cursor-pointer'}`}
        onClick={() => !expanded && setExpanded(true)}
      >
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge
                variant={core.phase === 'published' ? 'default' : 'secondary'}
                className="uppercase text-[9px] font-black tracking-widest"
              >
                {core.phase}
              </Badge>
              <h3 className="text-lg font-bold tracking-tight">Round {core.idx} Checkpoint</h3>
            </div>
            <div className="flex items-center gap-2">
              {journal.hash && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              <span className="text-[10px] font-mono text-muted-foreground uppercase">
                Verified
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
              >
                {expanded ? '−' : '+'}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-4 overflow-hidden">
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-[10px] font-black uppercase text-muted-foreground whitespace-nowrap">
                Hash:
              </span>
              <code className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 px-1 rounded truncate font-mono">
                {journal.hash}
              </code>
            </div>
            {core.prev_hash && (
              <div className="flex items-center gap-1 min-w-0">
                <LinkIcon className="w-3 h-3 text-slate-400" />
                <span className="text-[10px] font-black uppercase text-muted-foreground whitespace-nowrap">
                  Parent:
                </span>
                <code className="text-[10px] text-slate-500 bg-slate-500/5 px-1 rounded truncate font-mono">
                  {core.prev_hash.slice(0, 16)}...
                </code>
              </div>
            )}
          </div>

          {expanded && (
            <div className="mt-6 space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
              {/* Detailed Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border pb-1">
                    Round Core
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Transcripts</span>
                      <span className="font-mono font-bold">
                        {core.transcript_hashes?.length || 0} hashes
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Continue Tally</span>
                      <span className="font-mono font-bold">
                        Y:{core.continue_tally?.yes} / N:{core.continue_tally?.no}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Submit Deadline</span>
                      <span className="font-mono">
                        {new Date(core.submit_deadline_unix * 1000).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border pb-1">
                    Signature
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Algorithm</span>
                      <span className="font-bold">{sig.alg}</span>
                    </div>
                    <div className="flex flex-col gap-1 mt-2">
                      <span className="text-muted-foreground">Public Key (B64)</span>
                      <code className="text-[9px] break-all bg-slate-500/5 p-1 rounded font-mono leading-tight">
                        {sig.public_key_b64}
                      </code>
                    </div>
                  </div>
                </div>
              </div>

              {/* Raw JSON */}
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border pb-1">
                  Canonical Payload
                </div>
                <pre className="text-[10px] leading-relaxed bg-slate-950 text-slate-300 p-4 rounded-lg overflow-x-auto font-mono custom-scrollbar max-h-60">
                  {JSON.stringify(journal, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
