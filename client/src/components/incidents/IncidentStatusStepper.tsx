import clsx from 'clsx';
import { AlertTriangle, Bell, Flame, Truck } from 'lucide-react';

const FIRE_STEPS = [
  { id: 'reported', label: 'Reported', match: [/report/i, /pending/i, /verif/i, /open/i, /acknowledg/i], Icon: AlertTriangle },
  { id: 'dispatched', label: 'Dispatched', match: [/dispatch/i, /assign/i, /en route/i], Icon: Truck },
  { id: 'on_scene', label: 'On Scene', match: [/on scene/i], Icon: Truck },
  { id: 'fuc', label: 'FUC', match: [/under control/i, /\bfuc\b/i], Icon: Flame },
  { id: 'fire_out', label: 'Fire Out', match: [/fire out/i, /resolved/i, /closed/i], Icon: Bell },
] as const;

const GENERIC_STEPS = [
  { id: 'reported', label: 'Reported', match: [/report/i, /pending/i, /verif/i, /open/i], Icon: AlertTriangle },
  { id: 'acknowledged', label: 'Acknowledged', match: [/acknowledg/i, /unit_assigned/i, /assigned/i], Icon: Bell },
  { id: 'dispatched', label: 'Dispatched', match: [/dispatch/i], Icon: Truck },
  { id: 'en_route', label: 'En Route', match: [/en route/i], Icon: Truck },
  { id: 'on_scene', label: 'On Scene', match: [/on scene/i], Icon: Truck },
  { id: 'resolved', label: 'Resolved', match: [/resolved/i, /closed/i, /complete/i], Icon: Bell },
] as const;

function stepIndex(status: string, steps: typeof FIRE_STEPS | typeof GENERIC_STEPS): number {
  const s = status || '';
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].match.some((re) => re.test(s))) return i;
  }
  // Soft progress for active ops statuses
  if (/ongoing|in progress/i.test(s)) return Math.min(2, steps.length - 1);
  return 0;
}

interface IncidentStatusStepperProps {
  status: string;
  typeName?: string;
  className?: string;
}

/** Horizontal lifecycle stepper — fire-specific labels when type looks like a fire call. */
export function IncidentStatusStepper({ status, typeName, className }: IncidentStatusStepperProps) {
  const isFire = /fire|alarm|structural|smoke/i.test(typeName ?? '');
  const steps = isFire ? FIRE_STEPS : GENERIC_STEPS;
  const active = stepIndex(status, steps);

  return (
    <div className={clsx('w-full overflow-x-auto sidebar-scroll', className)} aria-label="Incident status progress">
      <ol className="flex min-w-[320px] items-start justify-between gap-1 px-1 py-2">
        {steps.map((step, idx) => {
          const done = idx <= active;
          const Icon = step.Icon;
          return (
            <li key={step.id} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
              {idx < steps.length - 1 && (
                <span
                  className={clsx(
                    'absolute left-[calc(50%+1.1rem)] right-[calc(-50%+1.1rem)] top-5 h-0.5',
                    idx < active ? 'bg-ok-500' : 'bg-navy-700'
                  )}
                  aria-hidden
                />
              )}
              <span
                className={clsx(
                  'relative z-[1] flex h-8 w-8 items-center justify-center rounded-full border-2 sm:h-10 sm:w-10',
                  done
                    ? 'border-ok-500 bg-ok-500/20 text-ok-400'
                    : 'border-navy-600 bg-navy-900 text-ink-500'
                )}
              >
                <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={2.2} aria-hidden />
              </span>
              <span
                className={clsx(
                  'mt-1.5 max-w-[4.25rem] font-mono text-[8px] font-semibold uppercase tracking-wide sm:mt-2 sm:text-[9px]',
                  done ? 'text-ok-400' : 'text-ink-500'
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
