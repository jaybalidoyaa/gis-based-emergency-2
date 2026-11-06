import { describe, expect, it } from 'vitest';
import { formatManilaDateTime, formatManilaTime, parseOpsInstant } from './timezone';

describe('parseOpsInstant / Manila formatters', () => {
  it('treats naive D1 UTC timestamps as UTC (not local Manila wall clock)', () => {
    // 10:43 UTC → 18:43 Asia/Manila
    const d = parseOpsInstant('2026-09-07 10:43:00');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-09-07T10:43:00.000Z');
    expect(formatManilaTime('2026-09-07 10:43:00')).toMatch(/6:43/);
    expect(formatManilaDateTime('2026-09-07 10:43:00')).toMatch(/Sep 7, 2026/);
  });

  it('preserves explicit Z timestamps', () => {
    const d = parseOpsInstant('2026-09-07T10:43:00Z');
    expect(d!.toISOString()).toBe('2026-09-07T10:43:00.000Z');
  });
});
