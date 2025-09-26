import Link from 'next/link';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/theme-toggle';

export default function Home() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">DB8 • Demos</h1>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button asChild>
            <Link href="/kitchen-sink">Kitchen Sink</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/spectate/demo">Spectator</Link>
          </Button>
        </div>
      </header>
      <section className="rounded-2xl border border-border p-6 space-y-3">
        <p>Use these pages to preview the style guide and mocked UI with shadcn components.</p>
        <ul className="list-disc pl-6">
          <li>
            <Link className="underline" href="/kitchen-sink">
              Kitchen Sink / Widgets
            </Link>
          </li>
          <li>
            <Link className="underline" href="/spectate/demo">
              Spectator View
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
