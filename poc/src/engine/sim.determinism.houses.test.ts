/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';

describe('dynasties & houses (a string of rulers becomes a family saga)', () => {
  it('a settlement is founded WITH a ruling House — the founding family, seated', () => {
    const w = createWorld(1);
    expect(w.houses.length).toBeGreaterThan(0);
    for (const h of w.houses) {
      expect(typeof h.name).toBe('string');
      // the founder is a real figure that points back at the house
      expect(w.figures.find((f) => f.id === h.founderId)?.houseId).toBe(h.id);
    }
    // a leader-bearing settlement's sitting ruler belongs to a house
    const seat = w.settlements.find((s) => s.currentRulerId !== undefined && s.ruinedYear === undefined);
    expect(seat).toBeDefined();
    expect(w.figures.find((f) => f.id === seat!.currentRulerId)?.houseId).toBeDefined();
  });

  it('a House FALLS when its seat is razed — the line ends (a scarred map already has some)', () => {
    let sawFallen = false;
    for (let seed = 1; seed < 16 && !sawFallen; seed++) {
      const w = createWorld(seed);
      runYears(w, 80);
      if (w.houses.some((h) => h.extinctYear !== undefined)) sawFallen = true;
    }
    expect(sawFallen).toBe(true);
  });

  it('houses are deterministic and survive a save/load intact', () => {
    const w = createWorld(3);
    runYears(w, 60);
    expect(w.houses.length).toBeGreaterThan(0);
    const reloaded = deserializeWorld(serializeWorld(w));
    expect(reloaded.houses).toEqual(w.houses);
    // and the figure→house links survive too
    expect(reloaded.figures.map((f) => f.houseId)).toEqual(w.figures.map((f) => f.houseId));
  });
});
