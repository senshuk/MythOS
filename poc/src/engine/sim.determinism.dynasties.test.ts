/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 *
 * This file isolates the single most expensive test in the suite — a multi-seed,
 * 160-year live run that must surface a multi-generation dynasty — so it sets the
 * parallel wall-clock floor alone rather than dragging a sibling along with it.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, buildSnapshot } from './sim';

describe('dynasties & houses (a string of rulers becomes a family saga)', () => {
  it('hereditary rule CONTINUES a house across generations — a real dynasty forms', () => {
    let sawDynasty = false;
    for (let seed = 1; seed < 8 && !sawDynasty; seed++) {
      const w = createWorld(seed);
      runYears(w, 160);
      const snap = buildSnapshot(w);
      expect(snap.houses.length).toBeGreaterThan(0);
      // the panel is ranked by prestige (descending)
      for (let i = 1; i < snap.houses.length; i++) {
        expect(snap.houses[i - 1].prestige).toBeGreaterThanOrEqual(snap.houses[i].prestige);
      }
      // a line that held a seat through several rulers — multi-generational depth
      if (snap.houses.some((h) => h.rulers >= 3)) sawDynasty = true;
    }
    expect(sawDynasty).toBe(true);
  });
});
