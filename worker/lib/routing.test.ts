import { describe, expect, it } from 'vitest';
import { astarRoute } from '../../worker/lib/routing';
import { kmeans } from '../../worker/lib/kmeans';

describe('routing A*', () => {
  it('returns a path from origin toward destination', () => {
    const path = astarRoute({ lat: 14.49, lng: 121.033 }, { lat: 14.492, lng: 121.035 });
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[0].lat).toBeCloseTo(14.49, 2);
  });
});

describe('kmeans', () => {
  it('groups points descriptively', () => {
    const groups = kmeans(
      [
        { lat: 14.49, lng: 121.033 },
        { lat: 14.491, lng: 121.034 },
        { lat: 14.5, lng: 121.04 },
        { lat: 14.501, lng: 121.041 },
      ],
      2
    );
    expect(groups.length).toBe(2);
    expect(groups[0].members.length + groups[1].members.length).toBe(4);
  });
});
