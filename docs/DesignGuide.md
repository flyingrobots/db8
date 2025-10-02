# DB8 Style Guide (shadcn/ui + Tailwind, JS-only)

A clean, production‑ready visual guide for DB8 that plays well with shadcn/ui
and Tailwind. True light/dark theme, accessible contrast, and a couple of
drop‑in pages you can wire to realtime later. JavaScript only (no TypeScript).

---

## Brand Palette (updated)

- Primary `#82DBAD` — actions, links, focus (mint)
- Success `#83DB82` — verified/winners
- Accent `#B0DB82` — highlights/warnings
- Info `#82DBD9` — informational accents
- Secondary `#82B0DB` — secondary CTAs/badges
- Dark bg `#0F1115` · Light bg `#F7F8FB`
- Text dark `#E6EAF3` · Text light `#0E1219`
- Neutrals (dark): surface `#161A21`, muted `#A9B1C6`, border `#232838`
- Neutrals (light): surface `#FFFFFF`, muted `#47506B`, border `#E6E9F0`

## Type & Rhythm

- Font stack: system UI (SF Pro / Segoe UI / Inter‑ish via `ui-sans-serif`)
- Sizes: xs/12, sm/14, base/16, lg/18, xl/20, 2xl/24, 3xl/30
- Leading: 1.4–1.6; headings tighter (1.2–1.3)
- Spacing scale: multiples of 4 (4/8/12/16/20/24/32/40)
- Cards: `rounded-2xl`; `shadow-sm` (light) or subtle inner ring (dark)

## Component Rules (shadcn/ui)

- Buttons
  - Primary: teal bg on dark, teal outline on light; text always high‑contrast
  - Destructive/Alert: magenta bg; avoid pure red for brand consistency
  - Ghost: text teal, hover surface tint
- Badges
  - Verified: ochre bg, dark text
  - Unsupported: magenta bg, dark text
  - Pending: neutral surface, muted text, dashed border
- Tabs/Segments: animated underline in teal; active weight +1
- Focus: accessible halo `0 0 0 3px rgba(86,194,198,.35)`

## Motion

- Snappy, purposeful: 120–180ms
- Continue vote YES pulses teal glow once
- Fact‑check verdict: scale 0.95 → 1.0 on commit (120ms)

## Data Viz (SVG)

- Evidence `#56C2C6`, Responsiveness `#C6568A`, Clarity `#C69256`, Civility
  `#7BA7D7`, Economy `#9BC9CB`
- Never rely on color alone — use shape/labels

---

## Tailwind + Theme Setup

Add Tailwind and shadcn/ui per your app conventions, then extend with these
settings.

### `tailwind.config.js`

````js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}',
  './pages/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0F1115', surface: '#161A21', border: '#232838', light:
        '#F7F8FB' },
        text: { DEFAULT: '#E6EAF3', muted: '#A9B1C6', dark: '#0E1219',
        lightMuted: '#47506B' },
        brand: {
          primary: '#82DBAD',
          success: '#83DB82',
          accent: '#B0DB82',
          info: '#82DBD9',
          secondary: '#82B0DB'
        }
      },
      boxShadow: {
        focus: '0 0 0 3px rgba(86,194,198,.35)'
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};
```text

### `app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
  --bg: #f7f8fb;
  --surface: #ffffff;
  --border: #e6e9f0;
  --text: #0e1219;
  --muted: #47506b;
  --teal: #82dbad;
  --magenta: #82b0db;
  --ochre: #83db82;
}

.dark {
  color-scheme: dark;
  --bg: #0f1115;
  --surface: #161a21;
  --border: #232838;
  --text: #e6eaf3;
  --muted: #a9b1c6;
  --teal: #82dbad;
  --magenta: #82b0db;
  --ochre: #83db82;
}

body {
  @apply bg-[var(--bg)] text-[var(--text)] antialiased;
}
.card {
  @apply bg-[var(--surface)] border border-[var(--border)] rounded-2xl;
}
.hr {
  @apply border-t border-[var(--border)];
}
.link {
  @apply text-brand-primary hover:opacity-90 underline-offset-2 underline;
}
.btn {
  @apply inline-flex items-center justify-center gap-2 font-medium rounded-xl
  px-4 py-2;
}
.btn-primary {
  @apply bg-brand-primary text-[#0F1115] hover:brightness-95 shadow;
}
.btn-ghost {
  @apply text-brand-primary
  hover:bg-[color-mix(in_oklab,var(--teal)20%,transparent)];
}
.badge {
  @apply px-2 py-0.5 rounded-md text-xs font-semibold;
}
.badge-verified {
  @apply bg-brand-success text-[#0F1115];
}
.badge-unsupported {
  @apply bg-brand-secondary text-[#0F1115];
}
.badge-pending {
  @apply bg-[var(--surface)] text-[var(--muted)] border border-dashed
  border-[var(--border)];
}
```text

### Light/Dark Toggle (`components/theme-toggle.jsx`)

```jsx
'use client';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('db8-theme');
    if (saved === 'dark') document.documentElement.classList.add('dark');
    setDark(saved === 'dark');
  }, []);
  function toggle() {
    const el = document.documentElement;
    const isDark = el.classList.toggle('dark');
    localStorage.setItem('db8-theme', isDark ? 'dark' : 'light');
    setDark(isDark);
  }
  return (
    <button onClick={toggle} className="btn btn-ghost" aria-pressed={dark}>
      {dark ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
}
```text

---

## Drop‑in Pages (Copy/Paste)

These are reference JSX pages you can drop into a Next.js app. Because this repo
isn’t a Next.js project yet, they’re documented here for copy‑paste.

### Kitchen‑Sink / Widgets (`app/kitchen-sink/page.jsx`)

```jsx
'use client';
import ThemeToggle from '@/components/theme-toggle';
import { useState } from 'react';

export default function KitchenSink() {
  const [voteOpen, setVoteOpen] = useState(false);
  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">DB8 • Kitchen Sink</h1>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <a className="btn btn-primary" href="/spectate/demo">
            Spectator Demo
          </a>
        </div>
      </header>

      <section className="card overflow-hidden">
        <img
          src="/img/banner_db8.jpg"
          alt="DB8 gladiatorial debate banner"
          className="w-full h-56 object-cover"
        />
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[var(--muted)]">Current Phase</div>
            <div className="text-xl font-semibold">SUBMIT — Round 2</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-[var(--muted)]">Server Countdown</div>
            <div className="text-2xl font-mono">02:14</div>
          </div>
        </div>
        <div className="hr my-4" />
        <div className="flex items-center gap-3">
          <span className="badge badge-verified">4 submitted</span>
          <span className="badge badge-pending">1 pending</span>
          <button className="btn btn-ghost" onClick={() => setVoteOpen(true)}>
            Open Continue Vote
          </button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Barrier Timeline</h2>
        <Timeline />
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Claim Map</h2>
        <ClaimMap />
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Scoring Radar</h2>
        <Radar />
      </section>

      {voteOpen && (
        <div className="fixed inset-0 bg-black/50 grid place-items-center p-6">
          <div className="card p-6 max-w-md w-full">
            <h3 className="text-xl font-semibold">Continue the debate?</h3>
            <p className="text-[var(--muted)] mt-1">Majority of participants
            decides.</p>
            <div className="flex gap-3 mt-4">
              <button className="btn btn-primary flex-1">Continue</button>
              <button className="btn flex-1" onClick={() => setVoteOpen(false)}>
                End
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Timeline() {
  return (
    <svg viewBox="0 0 800 120" className="w-full h-auto">
      <defs>
        <linearGradient id="g" x1="0" x2="1">
          <stop offset="0%" stopColor="#56C2C6" />
          <stop offset="50%" stopColor="#C6568A" />
          <stop offset="100%" stopColor="#C69256" />
        </linearGradient>
      </defs>
      <rect x="20" y="50" width="760" height="4" fill="url(#g)" />
      {['Research', 'Submit', 'Verify', 'Publish', 'Vote'].map((t, i) => (
        <g key={t} transform={`translate(${60 + i * 180},0)`}>
          <circle cx="0" cy="52" r="8" fill="var(--surface)"
          stroke="var(--border)" />
          <text
            x="0"
            y="90"
            textAnchor="middle"
            className="fill-[var(--muted)]"
            style={{ fontSize: 12 }}
          >
            {t}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ClaimMap() {
  return (
    <svg viewBox="0 0 600 280" className="w-full h-auto">
      <circle cx="110" cy="80" r="8" fill="#56C2C6" />
      <circle cx="110" cy="200" r="8" fill="#C6568A" />
      <circle cx="310" cy="140" r="10" fill="#C69256" />
      <line x1="110" y1="80" x2="310" y2="140" stroke="var(--border)" />
      <line x1="110" y1="200" x2="310" y2="140" stroke="var(--border)" />
      <text x="90" y="70" className="fill-[var(--muted)]" style={{ fontSize: 12
      }}>
        cite A
      </text>
      <text x="90" y="220" className="fill-[var(--muted)]" style={{ fontSize: 12
      }}>
        cite B
      </text>
      <text x="295" y="125" className="fill-[var(--muted)]" style={{ fontSize:
      12 }}>
        claim
      </text>
      <rect
        x="430"
        y="60"
        width="150"
        height="60"
        className="fill-[var(--surface)]"
        stroke="var(--border)"
        rx="10"
      />
      <text
        x="505"
        y="90"
        textAnchor="middle"
        className="fill-[var(--muted)]"
        style={{ fontSize: 12 }}
      >
        ✅ supported
      </text>
      <rect
        x="430"
        y="150"
        width="150"
        height="60"
        className="fill-[var(--surface)]"
        stroke="var(--border)"
        rx="10"
      />
      <text
        x="505"
        y="180"
        textAnchor="middle"
        className="fill-[var(--muted)]"
        style={{ fontSize: 12 }}
      >
        ❌ unsupported
      </text>
    </svg>
  );
}

function Radar() {
  const cx = 160,
    cy = 140,
    r = 80;
  const pts = [
    [0, -1],
    [0.95, -0.3],
    [0.6, 0.8],
    [-0.6, 0.8],
    [-0.95, -0.3]
  ]
    .map(([x, y]) => `${cx + x * r},${cy + y * r}`)
    .join(' ');
  return (
    <svg viewBox="0 0 320 280" className="w-full h-auto">
      <polygon points={pts} fill="none" stroke="var(--border)" />
      <polygon points={pts} fill="rgba(86,194,198,.18)" stroke="#56C2C6" />
      {['Evidence', 'Resp.', 'Clarity', 'Civility', 'Economy'].map((t, i) => {
        const ang = -90 + i * 72,
          rad = (ang * Math.PI) / 180;
        const x = cx + Math.cos(rad) * (r + 16),
          y = cy + Math.sin(rad) * (r + 16);
        return (
          <text
            key={t}
            x={x}
            y={y}
            textAnchor="middle"
            className="fill-[var(--muted)]"
            style={{ fontSize: 11 }}
          >
            {t}
          </text>
        );
      })}
    </svg>
  );
}
```text

### Spectator View (`app/spectate/[roomId]/page.jsx`)

```jsx
'use client';
import ThemeToggle from '@/components/theme-toggle';
import { useMemo } from 'react';

export default function SpectatorPage({ params }) {
  const roomId = params.roomId || 'demo';
  const phase = 'PUBLISHED'; const roundIdx = 2;
  const endsAt = Date.now() + 45_000;

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Room {roomId}</h1>
          <p className="text-[var(--muted)]">Topic: Should open models outpace
          closed?</p>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <a className="btn btn-primary" href="/kitchen-sink">Widgets</a>
        </div>
      </header>

      <section className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="badge badge-verified">Phase: {phase}</span>
            <span className="badge badge-pending">Round {roundIdx}</span>
          </div>
          <Countdown endsAt={endsAt}/>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        {MOCK_SUBS.map((s, i)=>(
          <article key={i} className="card p-4 space-y-3">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar kind={s.kind}/>
                <h3 className="font-semibold">{s.alias}</h3>
              </div>
              <span className={
                s.verdict==='supported' ? 'badge badge-verified' :
                s.verdict==='partial' ? 'badge' : 'badge badge-unsupported'
              }>
                {s.verdict === 'supported' ? '✅ supported' :
                s.verdict==='partial' ? '⚠️ partial' : '❌ unsupported'}
              </span>
            </header>
            <p className="text-sm leading-6">{s.content}</p>
            <footer className="text-xs">
              Citations:{' '}
              {s.citations map((c, j)=>(
                <a key={j} href={c.url} className="link mr-2" target="_blank"
                rel="noreferrer">{c.label}</a>
              ))}
            </footer>
          </article>
        ))}
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-[var(--muted)]">Continue vote</div>
          <div className="flex items-center gap-2">
            <span className="badge badge-verified">YES 3</span>
            <span className="badge badge-unsupported">NO 2</span>
          </div>
        </div>
      </section>

      <section className="text-sm text-[var(--muted)] flex items-center
      justify-between">
        <div>Checkpoint: <code className="px-1.5 py-0.5 bg-[var(--surface)]
        border border-[var(--border)] rounded-md">chain_N=5c7…9a</code></div>
        <a className="link" href="#">View signed journal →</a>
      </section>
    </main>
  );
}

function Countdown({ endsAt }) {
  const s = useMemo(()=>Math.max(0, Math.floor((endsAt - Date.now())/1000)),
  [endsAt]);
  return <div className="font-mono text-lg">{String(s).padStart(2,'0')}s</div>;
}

function Avatar({ kind }) {
  const map = { bag: '🛍️', ski: '🎿', robot: '🤖', crt: '🖥️', holo: '🟦' };
  return (
    <span className="grid place-items-center w-8 h-8 rounded-full
    bg-[var(--surface)] border border-[var(--border)]">
      <span aria-hidden>{map[kind] || '❓'}</span>
    </span>
  );
}

const MOCK_SUBS = [
  { alias:'anon_1', kind:'bag', verdict:'supported',
    content:'Open ecosystems enable compounding contributions via re‑use and
    fork pressure.',
    citations:[{label:'arXiv', url:'#'},{label:'Nature', url:'#'}]
  },
  { alias:'anon_2', kind:'ski', verdict:'partial',
    content:'Closed models accelerate alignment due to funding concentration;
    evidence is mixed.',
    citations:[{label:'Whitepaper', url:'#'}]
  },
  { alias:'anon_3', kind:'robot', verdict:'unsupported',
    content:'Openness trivially halves training costs (claim lacks support).',
    citations:[{label:'Blog', url:'#'}]
  },
  { alias:'anon_4', kind:'crt', verdict:'supported',
    content:'Community evals increase failure discovery rate by 3–5×.',
    citations:[{label:'Report', url:'#'},{label:'Repo', url:'#'}]
  }
];
```text

---

## Where to Put Assets

```text
public/
  img/banner_db8.jpg
app/
  kitchen-sink/page.jsx
  spectate/[roomId]/page.jsx
components/
  theme-toggle.jsx
```text

---

## A11y & Perf Checklist

- Minimum contrast AA for text; dark theme passes out‑of‑the‑box
- All images have descriptive alt; interactive elements keyboard‑reachable and
  visible focus
- Respect reduced motion (optional: gate animations under `@media
  (prefers-reduced-motion)`)
- Lazy‑load heavy assets; prefetch realtime scripts only on pages that need them

---

## Next Step (Optional)

- I can generate two tiny SVG diagrams in the house palette: Barrier Timeline
  and Hash‑Chain Proof (drop in `public/img/`).
- Or wire the Spectator page to Supabase Realtime scaffolding.
````
