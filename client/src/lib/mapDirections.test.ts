import { describe, expect, it } from 'vitest';
import { formatDelayLabel, formatDurationMinutes } from './mapDirections';

describe('mapDirections labels', () => {
  it('formats minutes and hours', () => {
    expect(formatDurationMinutes(90)).toBe('2 min');
    expect(formatDurationMinutes(3600)).toBe('1h');
  });

  it('labels traffic delay', () => {
    expect(formatDelayLabel(10)).toBe('On time');
    expect(formatDelayLabel(180)).toBe('+3 min traffic');
  });
});
