import clsx from 'clsx';

const variants: Record<string, string> = {
  Available: 'bg-ok-500/15 text-ok-400 border-ok-500/30',
  Ready: 'bg-ok-500/15 text-ok-400 border-ok-500/30',
  Dispatched: 'bg-navy-700 text-ink-100 border-navy-600',
  'En Route': 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  'On Scene': 'bg-alert-500/15 text-alert-400 border-alert-500/40',
  Transporting: 'bg-gold-500/10 text-gold-400 border-gold-600/30',
  'Out of Service': 'bg-navy-800 text-ink-400 border-navy-600',
  Pending: 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  'Pending Verification': 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  'Pending Dispatcher Verification': 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  Verified: 'bg-navy-700 text-ink-100 border-navy-600',
  Open: 'bg-ok-500/10 text-ok-400 border-ok-500/30',
  Assigned: 'bg-navy-700 text-gold-400 border-navy-600',
  Resolved: 'bg-ok-500/15 text-ok-400 border-ok-500/30',
  Closed: 'bg-navy-800 text-ink-400 border-navy-600',
  Moderate: 'bg-gold-500/15 text-gold-400 border-gold-600/30',
  Dispatching: 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  Acknowledged: 'bg-navy-700 text-ink-100 border-navy-600',
  Cancelled: 'bg-navy-800 text-ink-400 border-navy-600',
  Duplicate: 'bg-navy-800 text-ink-400 border-navy-600',
  Reopened: 'bg-alert-500/15 text-alert-400 border-alert-500/30',
  Escalated: 'bg-alert-500/20 text-alert-400 border-alert-500/40',
  Returning: 'bg-navy-700 text-ink-200 border-navy-600',
  'At Hospital/Destination': 'bg-ok-500/10 text-ok-400 border-ok-500/30',
  Declined: 'bg-alert-500/15 text-alert-400 border-alert-500/30',
  Critical: 'bg-alert-500/20 text-alert-400 border-alert-500/40',
  High: 'bg-alert-500/15 text-alert-400 border-alert-500/30',
  Medium: 'bg-gold-500/15 text-gold-400 border-gold-600/30',
  Low: 'bg-navy-800 text-ink-400 border-navy-600',
  Ongoing: 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  'Up Next': 'bg-navy-700 text-ink-200 border-navy-600',
  Scheduled: 'bg-navy-800 text-ink-300 border-navy-600',
  Done: 'bg-ok-500/15 text-ok-400 border-ok-500/30',
  Upcoming: 'bg-[#3b82f6]/15 text-[#7aa2d4] border-[#3b82f6]/30',
  Missed: 'bg-alert-500/15 text-alert-400 border-alert-500/30',
  'On Duty': 'bg-ok-500/15 text-ok-400 border-ok-500/30',
  'In Progress': 'bg-gold-500/20 text-gold-300 border-gold-500/40',
  Completed: 'bg-ok-500/20 text-ok-300 border-ok-500/40',
  Canceled: 'bg-alert-500/20 text-alert-300 border-alert-500/40',
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium',
        variants[status] ?? 'bg-navy-800 text-ink-300 border-navy-600',
        className
      )}
      aria-label={`Status: ${status}`}
    >
      {status}
    </span>
  );
}
