import { describe, expect, it } from 'vitest';
import { isTerminalIncidentStatus, TERMINAL_INCIDENT_STATUSES } from './assignmentLifecycle';

describe('assignmentLifecycle', () => {
  it('recognizes terminal incident statuses', () => {
    for (const s of TERMINAL_INCIDENT_STATUSES) {
      expect(isTerminalIncidentStatus(s)).toBe(true);
    }
    expect(isTerminalIncidentStatus('Open')).toBe(false);
    expect(isTerminalIncidentStatus('Dispatched')).toBe(false);
    expect(isTerminalIncidentStatus('En Route')).toBe(false);
  });
});
