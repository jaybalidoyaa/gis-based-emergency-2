const PH_MOBILE = /^(09|\+639|639)\d{9}$/;

export function normalizePhPhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, '');
  if (!PH_MOBILE.test(digits)) return null;
  if (digits.startsWith('+63')) return `0${digits.slice(3)}`;
  if (digits.startsWith('63')) return `0${digits.slice(2)}`;
  return digits;
}

export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push('at least 10 characters');
  if (!/[A-Z]/.test(password)) issues.push('one uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('one lowercase letter');
  if (!/\d/.test(password)) issues.push('one number');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('one special character');
  return issues;
}

export const INCIDENT_CATEGORIES = [
  'Medical Emergency',
  'Fire Alarm',
  'Vehicular Accident',
  'Road Traffic Accident',
  'Trauma',
  'Conduction',
  'Oil Spill',
  'Rescue',
  'Hazardous Materials',
  'Other Emergency',
] as const;

export const PRIORITIES = ['Critical', 'High', 'Moderate', 'Low'] as const;

export const SUN_VALLEY_CENTER = { lat: 14.48996, lng: 121.03391 };

export const UNIT_READY = new Set(['Ready', 'Available']);
