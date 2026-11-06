import { describe, expect, it } from 'vitest';
import {
  allowedNextStatuses,
  canAssignIncident,
  canCancelIncident,
  canReopenIncident,
  canVerifyIncident,
  formatRole,
  fromOperationalTime,
  isIncidentReadonly,
  toOperationalTime,
} from './incidentState';

describe('incident state machine gates', () => {
  it('treats Cancelled as read-only', () => {
    expect(isIncidentReadonly('Cancelled')).toBe(true);
    expect(canAssignIncident('Cancelled')).toBe(false);
    expect(canCancelIncident('Cancelled')).toBe(false);
    expect(canVerifyIncident('Cancelled')).toBe(false);
    expect(canReopenIncident('Cancelled')).toBe(true);
  });

  it('allows assign on Open and Reopened', () => {
    expect(canAssignIncident('Open')).toBe(true);
    expect(canAssignIncident('Reopened')).toBe(true);
    expect(canAssignIncident('Pending Verification')).toBe(false);
  });

  it('formats roles for display', () => {
    expect(formatRole('EMERGENCY_RESPONDER')).toBe('Emergency Responder');
  });

  it('converts operational time formats', () => {
    expect(toOperationalTime('08:00')).toBe('0800H');
    expect(fromOperationalTime('0800H')).toBe('08:00');
  });

  it('lists allowed next statuses for Resolved', () => {
    expect(allowedNextStatuses('Resolved')).toEqual(['Closed', 'Reopened']);
  });
});
