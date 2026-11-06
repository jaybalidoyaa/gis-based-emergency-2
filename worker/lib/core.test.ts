import { describe, expect, it } from 'vitest';
import { canTransition, canResponderTransition, num, normalizePhPhone, sosStatusFromIncident } from './core';

describe('incident transitions', () => {
  it('allows Pending Verification to Verified', () => {
    expect(canTransition('Pending Verification', 'Verified')).toBe(true);
  });
  it('allows Resolved to Reopened', () => {
    expect(canTransition('Resolved', 'Reopened')).toBe(true);
  });
  it('rejects Closed to Assigned', () => {
    expect(canTransition('Closed', 'Assigned')).toBe(false);
  });
});

describe('responder transitions', () => {
  it('blocks Available to On Scene without going through assignment states', () => {
    expect(canResponderTransition('Available', 'On Scene')).toBe(false);
  });
  it('allows En Route to On Scene', () => {
    expect(canResponderTransition('En Route', 'On Scene')).toBe(true);
  });
});

describe('d1 count coercion', () => {
  it('turns string counts into numbers', () => {
    expect(num('5')).toBe(5);
    expect(num(undefined)).toBe(0);
  });
});

describe('phone', () => {
  it('normalizes PH mobiles', () => {
    expect(normalizePhPhone('+639171234567')).toBe('09171234567');
  });
});

describe('sosStatusFromIncident', () => {
  it('keeps triage states as Pending', () => {
    expect(sosStatusFromIncident('Pending Verification')).toBe('Pending');
    expect(sosStatusFromIncident('Reopened')).toBe('Pending');
  });
  it('marks active response as In Progress', () => {
    expect(sosStatusFromIncident('Open')).toBe('In Progress');
    expect(sosStatusFromIncident('En Route')).toBe('In Progress');
    expect(sosStatusFromIncident('On Scene')).toBe('In Progress');
  });
  it('marks finished work as Resolved or Cancelled', () => {
    expect(sosStatusFromIncident('Resolved')).toBe('Resolved');
    expect(sosStatusFromIncident('Closed')).toBe('Resolved');
    expect(sosStatusFromIncident('Cancelled')).toBe('Cancelled');
    expect(sosStatusFromIncident('False Alarm')).toBe('Cancelled');
    expect(sosStatusFromIncident('Duplicate')).toBe('Rejected');
  });
});
