'use client';
import ThemeToggle from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export default function SpectatorPage({ params }) {
  const roomId = params.roomId || 'demo';
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
            <Badge variant="success">Phase: PUBLISHED</Badge>
            <Badge>Round 2</Badge>
          </div>
          <div className="font-mono text-lg">--s</div>
        </CardContent>
      </Card>
    </main>
  );
}
