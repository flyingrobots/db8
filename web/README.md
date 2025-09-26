# DB8 Web (Next.js + shadcn/ui, JS-only)

This is a lightweight Next.js app using Tailwind + shadcn‑style components (JavaScript only). It mirrors the Design Guide and provides Kitchen Sink and Spectator pages.

## Run

```
cd web
npm install
npm run dev
```

Open http://localhost:3001

## Theme tokens

Brand palette mapped in `app/globals.css` via CSS variables:

- --primary: #82DBAD
- --success: #83DB82
- --secondary: #82B0DB
- neutrals for light/dark in `--background/--foreground/--card/--border/--muted`

## Pages

- `/` — index (links)
- `/kitchen-sink` — widgets page using shadcn‑style Button/Badge/Card
- `/spectate/[roomId]` — spectator skeleton (realtime‑ready)

## Notes

- No TypeScript; components are simple JS.
- Can be wired to server SSE at `/events?room_id=...` later for countdowns.
- For the full style guide, see `../docs/DesignGuide.md`.
