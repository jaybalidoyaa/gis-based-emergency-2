import { describe, it, expect } from 'vitest';
import { canTransition } from '../services/incident.service.js';

describe('incident status transitions', () => {
  it('allows Pending Verification to Verified', () => {
    expect(canTransition('Pending Verification', 'Verified')).toBe(true);
  });

  it('allows Verified to Open', () => {
    expect(canTransition('Verified', 'Open')).toBe(true);
  });

  it('rejects Closed to Open', () => {
    expect(canTransition('Closed', 'Open')).toBe(false);
  });

  it('allows On Scene to Transporting', () => {
    expect(canTransition('On Scene', 'Transporting')).toBe(true);
  });

  it('allows Resolved to Closed', () => {
    expect(canTransition('Resolved', 'Closed')).toBe(true);
  });
});
