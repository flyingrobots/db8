'use client';
import ThemeToggle from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export default function KitchenSink() {
  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">DB8 • Kitchen Sink</h1>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button asChild>
            <a href="/spectate/demo">Spectator Demo</a>
          </Button>
        </div>
      </header>

      <Card className="overflow-hidden">
        <div className="w-full h-56 grid place-items-center text-muted">banner_db8.jpg</div>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted">Current Phase</div>
              <div className="text-xl font-semibold">SUBMIT — Round 2</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted">Server Countdown</div>
              <div className="text-2xl font-mono">02:14</div>
            </div>
          </div>
          <div className="my-4 border-t border-border" />
          <div className="flex items-center gap-3">
            <Badge variant="success">4 submitted</Badge>
            <Badge>1 pending</Badge>
            <Button variant="ghost">Open Continue Vote</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
