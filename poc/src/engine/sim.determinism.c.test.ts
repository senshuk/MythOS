/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless, hashWorld, runYears, createWorld, focusSettlement } from './sim';

describe('determinism', () => {
  it('different seeds diverge (proves novelty, not a frozen world)', () => {
    const hs = [1, 2, 3].map((s) => hashWorld(runHeadless(s, 60)));
    expect(new Set(hs).size).toBe(3);
  });

  it('running in two steps equals running in one (composability of ticks)', () => {
    const oneShot = runHeadless(777, 50);
    const split = runHeadless(777, 30);
    runYears(split, 20);
    expect(hashWorld(split)).toBe(hashWorld(oneShot));
  });

  it('different focus scripts on the same seed diverge', () => {
    const a = createWorld(555);
    runYears(a, 40);
    const b = createWorld(555);
    focusSettlement(b, 4);
    runYears(b, 40);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});
