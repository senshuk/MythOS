/**
 * The AUTOPILOT (design/26 P1): an undirected week is lived by the same decider as
 * every other soul — the character keeps living while streamed time runs, and the
 * player intervenes. Before this, an undirected week resolved as `idle`: pressing
 * play as a possessed character meant years of resting (no income, mood decay).
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, possess } from './sim';
import { fullActors } from './world';
import { SUBSISTENCE_NEED, WEALTH_NEED, maturityOf } from './pack';

describe('the autopilot — undirected weeks are lived, not idled', () => {
  it('a possessed, never-directed actor sustains themselves and builds bonds for years', () => {
    const w = createWorld(123456);
    // a young adult, so natural death cannot confound the run
    const p = fullActors(w).find((id) => {
      const lc = w.lifecycle.get(id)!;
      const idn = w.identity.get(id)!;
      const mat = maturityOf(idn.speciesId);
      return lc.alive && lc.ageYears >= mat + 2 && lc.ageYears <= mat + 15;
    })!;
    expect(p).toBeDefined();
    possess(w, p);

    runYears(w, 3); // three years, not one scheduled intent

    // they lived — an idle actor starves/withers; the autopilot works when hungry
    expect(w.lifecycle.get(p)?.alive).toBe(true);
    const needs = w.needs.get(p)!;
    expect(needs[SUBSISTENCE_NEED]).toBeGreaterThan(250);
    expect(needs[WEALTH_NEED]).toBeGreaterThan(200);
    // …and kept a social life (the decider socializes; idleness builds nothing)
    expect((w.rels.get(p)?.size ?? 0)).toBeGreaterThanOrEqual(3);
  });

  it('possession without direction still leaves the input log empty (autopilot is not input)', () => {
    const w = createWorld(99);
    const p = fullActors(w).find((id) => w.lifecycle.get(id)!.alive && w.lifecycle.get(id)!.ageYears >= 25)!;
    possess(w, p);
    runYears(w, 1);
    expect(w.playerInputs.length).toBe(0); // replay-determinism: lived weeks are derived, not recorded
  });
});
