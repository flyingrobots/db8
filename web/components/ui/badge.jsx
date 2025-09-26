import { cn } from '@/lib/utils';

export function Badge({ variant = 'default', className, ...props }) {
  const styles = {
    default: 'bg-[var(--surface)] text-[var(--muted)] border border-dashed border-border',
    success: 'bg-[var(--success)] text-[#0F1115]',
    secondary: 'bg-[var(--secondary)] text-[#0F1115]'
  };
  return (
    <span
      className={cn('text-xs font-semibold px-2 py-0.5 rounded-md', styles[variant], className)}
      {...props}
    />
  );
}
