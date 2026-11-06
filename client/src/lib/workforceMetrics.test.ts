import { describe, expect, it } from 'vitest';
import {
  classifyPersonnelDuty,
  isAttendanceAbsent,
  isAttendancePresent,
  isLowStockQuantity,
  isPersonnelOnDutyStatus,
  LOW_STOCK_QTY,
} from './workforceMetrics';

describe('workforceMetrics', () => {
  it('treats Available/Assigned/En Route as on duty', () => {
    expect(isPersonnelOnDutyStatus('Available')).toBe(true);
    expect(isPersonnelOnDutyStatus('En Route')).toBe(true);
    expect(classifyPersonnelDuty('On Scene')).toBe('on_duty');
    expect(classifyPersonnelDuty('Off Duty')).toBe('off_duty');
    expect(classifyPersonnelDuty('On Leave')).toBe('leave');
  });

  it('separates attendance present from roster duty vocabulary', () => {
    expect(isAttendancePresent('Present')).toBe(true);
    expect(isAttendancePresent('On Duty')).toBe(true);
    expect(isAttendanceAbsent('Absent')).toBe(true);
    expect(isAttendanceAbsent('Present')).toBe(false);
  });

  it('uses shared low-stock threshold', () => {
    expect(LOW_STOCK_QTY).toBe(2);
    expect(isLowStockQuantity(2)).toBe(true);
    expect(isLowStockQuantity(3)).toBe(false);
  });

  it('normalizes personnel list payload shape', async () => {
    const { personnelUsersFromResponse, asArray } = await import('./workforceMetrics');
    expect(personnelUsersFromResponse({ users: [{ status: 'Available' }] })).toHaveLength(1);
    expect(personnelUsersFromResponse([{ status: 'Available' }])).toHaveLength(1);
    expect(personnelUsersFromResponse({ users: 'bad' })).toEqual([]);
    expect(asArray(null)).toEqual([]);
    expect(asArray([1])).toEqual([1]);
  });
});
