import { cn } from '@/lib/utils';

export function Card({ className, ...props }) {
  return <div className={cn('rounded-2xl border border-border bg-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('p-4 border-b border-border', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-4', className)} {...props} />;
}
