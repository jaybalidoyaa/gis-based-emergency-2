import clsx from 'clsx';

export const INCIDENT_ENVIRONMENT = {
  PRODUCTION: 'PRODUCTION',
  TEST: 'TEST',
  TRAINING: 'TRAINING',
  AUDIT: 'AUDIT',
} as const;

export type IncidentEnvironment = (typeof INCIDENT_ENVIRONMENT)[keyof typeof INCIDENT_ENVIRONMENT];

export const ENVIRONMENT_BADGE: Record<
  string,
  { label: string; emoji: string; className: string }
> = {
  TEST: {
    label: 'TEST',
    emoji: '🧪',
    className: 'bg-gold-500/15 text-gold-400 border border-gold-600/30',
  },
  TRAINING: {
    label: 'TRAINING',
    emoji: '🎓',
    className: 'bg-[#3b82f6]/15 text-[#7aa2d4] border border-[#3b82f6]/30',
  },
  AUDIT: {
    label: 'AUDIT',
    emoji: '📝',
    className: 'bg-navy-700 text-ink-300 border border-navy-600',
  },
};

/**
 * Small inline badge rendered for non-PRODUCTION incidents.
 * Returns null for PRODUCTION or undefined environments.
 */
export function EnvironmentBadge({ env }: { env?: string }) {
  if (!env || env === INCIDENT_ENVIRONMENT.PRODUCTION) return null;

  const meta = ENVIRONMENT_BADGE[env];
  if (!meta) return null;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide',
        meta.className
      )}
      aria-label={`Environment: ${meta.label}`}
    >
      <span aria-hidden="true">{meta.emoji}</span>
      {meta.label}
    </span>
  );
}
