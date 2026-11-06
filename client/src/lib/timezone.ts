/** Operations timezone for Barangay Sun Valley / Brigada Onse SVFAR */
export const OPS_TIMEZONE = 'Asia/Manila';

const manilaDateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: OPS_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const manilaTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: OPS_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const manilaDateTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: OPS_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const manilaWeekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: OPS_TIMEZONE,
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: '2-digit',
});

const manilaYmdParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Parse ops timestamps. D1 `datetime('now')` stores UTC without a zone suffix.
 * Treat naive `YYYY-MM-DD HH:MM:SS` / `YYYY-MM-DDTHH:MM:SS` as UTC so Manila formatting is correct.
 */
export function parseOpsInstant(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const hasZone = /Z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw);
  const iso = hasZone ? raw : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) return d;
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function formatManilaDate(value: Date | string | number | null | undefined): string {
  const d = parseOpsInstant(value);
  if (!d) return '—';
  return manilaDateFmt.format(d);
}

export function formatManilaTime(value: Date | string | number | null | undefined): string {
  const d = parseOpsInstant(value);
  if (!d) return '—';
  return manilaTimeFmt.format(d);
}

/** Format: `Sep 3, 2026 • 10:35 PM` */
export function formatLastUpdated(value: Date | string | number | null | undefined): string {
  const d = parseOpsInstant(value);
  if (!d) return '—';
  const datePart = manilaDateFmt.format(d);
  const timePart = manilaTimeFmt.format(d);
  return `${datePart} • ${timePart}`;
}

export function formatManilaDateTime(value: Date | string | number | null | undefined): string {
  const d = parseOpsInstant(value);
  if (!d) return '—';
  return manilaDateTimeFmt.format(d);
}

export function formatManilaWeekdayDate(value: Date = new Date()): string {
  return manilaWeekdayFmt.format(value);
}

/** YYYY-MM-DD in Asia/Manila */
export function manilaTodayYmd(value: Date = new Date()): string {
  return manilaYmdParts.format(value);
}

export function elapsedLabel(from: Date | string | number | null | undefined, to: Date = new Date()): string | null {
  const start = parseOpsInstant(from);
  if (!start) return null;
  const ms = Math.max(0, to.getTime() - start.getTime());
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return `${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
