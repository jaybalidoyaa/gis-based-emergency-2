/** Shared workforce / duty status contracts — keep aligned with worker PERSONNEL_ON_DUTY_SQL. */

export const PERSONNEL_ON_DUTY_STATUSES = [
  'Available',
  'Assigned',
  'Dispatched',
  'En Route',
  'On Scene',
  'Transporting',
] as const;

export const PERSONNEL_OFF_DUTY_STATUSES = ['Off Duty', 'Out of Service', 'Unavailable', 'Inactive'] as const;

export function isPersonnelOnDutyStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim();
  return (PERSONNEL_ON_DUTY_STATUSES as readonly string[]).includes(s);
}

export function classifyPersonnelDuty(status: string | null | undefined): 'on_duty' | 'off_duty' | 'leave' | 'other' {
  const s = String(status ?? '').trim().toLowerCase();
  if (!s) return 'other';
  if (/leave|vacation|sick/.test(s)) return 'leave';
  if ((PERSONNEL_OFF_DUTY_STATUSES as readonly string[]).some((x) => x.toLowerCase() === s) || /off.?duty|out of service|inactive|unavail/.test(s)) {
    return 'off_duty';
  }
  if (isPersonnelOnDutyStatus(status)) return 'on_duty';
  if (/available|assigned|dispatched|en.?route|on.?scene|transport|patrol/.test(s)) return 'on_duty';
  return 'other';
}

/** Attendance "present" = checked in / recorded present — not the same as roster on-duty. */
export function isAttendancePresent(status: string | null | undefined): boolean {
  return /present|on duty|checked.?in|time.?in/i.test(String(status ?? ''));
}

export function isAttendanceAbsent(status: string | null | undefined): boolean {
  return /absent|no.?show|missed/i.test(String(status ?? ''));
}

/** Normalize /api/personnel payload — API returns `{ users, responders }`, never a bare array. */
export function personnelUsersFromResponse(data: unknown): Array<{
  availabilityStatus?: string;
  operationalStatus?: string;
  status?: string;
  accountStatus?: string;
  responderId?: string;
  [key: string]: unknown;
}> {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === 'object' && data !== null) {
    const obj = data as { users?: unknown; responders?: unknown };
    if (Array.isArray(obj.users)) return obj.users;
    if (Array.isArray(obj.responders)) return obj.responders;
  }
  return [];
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Equipment low-stock: shared threshold for alerts, filters, and row badges. */
export const LOW_STOCK_QTY = 2;

export function isLowStockQuantity(qty: number | null | undefined): boolean {
  return (qty ?? 0) <= LOW_STOCK_QTY;
}
