import { describe, expect, it } from 'vitest';
import { normalizePhPhone, passwordIssues, UNIT_READY } from './validation';

describe('Philippine phone validation', () => {
  it('accepts 09XXXXXXXXX', () => {
    expect(normalizePhPhone('09171234567')).toBe('09171234567');
  });

  it('normalizes +63', () => {
    expect(normalizePhPhone('+639171234567')).toBe('09171234567');
  });

  it('rejects short numbers', () => {
    expect(normalizePhPhone('0917')).toBeNull();
  });
});

describe('password rules', () => {
  it('requires complexity', () => {
    expect(passwordIssues('short')).toContain('at least 10 characters');
    expect(passwordIssues('Password123!')).toEqual([]);
  });
});

describe('unit readiness', () => {
  it('treats Ready and Available as the same source', () => {
    expect(UNIT_READY.has('Ready')).toBe(true);
    expect(UNIT_READY.has('Available')).toBe(true);
    expect(UNIT_READY.has('Out of Service')).toBe(false);
  });
});
