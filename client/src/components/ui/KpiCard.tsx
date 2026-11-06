import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

type KpiTone = 'default' | 'alert' | 'gold' | 'ok' | 'info';

const TONE: Record<KpiTone, { card: string; icon: string; value: string }> = {
  default: {
    card: 'border-navy-700 bg-navy-900',
    icon: 'bg-navy-800 text-gold-500',
    value: 'text-ink-50',
  },
  alert: {
    card: 'border-alert-500/40 bg-alert-500/10',
    icon: 'bg-alert-500/20 text-alert-400',
    value: 'text-ink-50',
  },
  gold: {
    card: 'border-gold-600/40 bg-gold-500/10',
    icon: 'bg-gold-500/20 text-gold-400',
    value: 'text-ink-50',
  },
  ok: {
    card: 'border-ok-500/40 bg-ok-500/10',
    icon: 'bg-ok-500/20 text-ok-400',
    value: 'text-ink-50',
  },
  info: {
    card: 'border-navy-600 bg-navy-900',
    icon: 'bg-navy-800 text-ink-200',
    value: 'text-ink-50',
  },
};

interface KpiCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  subtitle?: string;
  /** Native tooltip shown on hover (title attribute). */
  tooltip?: string;
  tone?: KpiTone;
  /** @deprecated use tone */
  accent?: string;
  className?: string;
}

export function KpiCard({
  title,
  value,
  icon: Icon,
  subtitle,
  tooltip,
  tone = 'default',
  accent,
  className,
}: KpiCardProps) {
  const t = TONE[tone];
  return (
    <div
      className={clsx(
        'card flex h-full min-w-0 items-start justify-between gap-2 border p-3 sm:gap-3 sm:p-4',
        t.card,
        className
      )}
      title={tooltip}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-ink-400">{title}</p>
        <p className={clsx('mt-1 font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl', t.value)}>
          {value}
        </p>
        {subtitle ? <p className="mt-1.5 truncate text-[11px] text-ink-400 sm:text-xs">{subtitle}</p> : null}
      </div>
      <div className={clsx('shrink-0 rounded-lg p-2 sm:p-2.5', accent ?? t.icon)}>
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
      </div>
    </div>
  );
}
