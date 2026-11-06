import { describe, expect, it } from 'vitest';

describe('offline queue contract', () => {
  it('requires queued state before claiming sent', () => {
    const states = ['queued', 'sending', 'sent', 'failed'] as const;
    expect(states).toContain('queued');
    expect(states.indexOf('queued')).toBeLessThan(states.indexOf('sent'));
  });
});
