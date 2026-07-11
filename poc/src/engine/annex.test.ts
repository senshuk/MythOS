/**
 * ANNEXATION (Phase 2E) — the first world action that deliberately redraws the political map.
 * When a realm overwhelms a far weaker neighbour, an EXPANSIONIST victor TAKES the town rather
 * than razing it: the settlement survives, its old dynasty is deposed and its polity dissolves,
 * and it passes into the victor's realm as a PROVINCE (governed from the capital, raising no
 * local line of its own). Any other victor still razes. Deterministic — the choice reads the
 * conqueror's 2C intent, and the geo RNG stream is kept aligned so only the OUTCOME differs.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears } from './sim';
import { geographyYearly } from './lod';
import { figuresYearly } from './figures';
import { getOrganization } from './organization';
import type { OrgIntent } from './model';

/** A strong aggressor adjacent to a weak town it will overwhelm; the victor's intent set by caller. */
function siege(w: ReturnType<typeof createWorld>, expansionist: boolean) {
  let strongId = -1, weakId = -1;
  for (const e of w.edges) {
    const A = w.settlements[e.a], B = w.settlements[e.b];
    if (A.polityId !== undefined && B.polityId !== undefined && !A.detailed && !B.detailed &&
        A.ruinedYear === undefined && B.ruinedYear === undefined && A.polityId !== B.polityId) {
      // the bigger will be the aggressor/victor
      [strongId, weakId] = A.macro.population >= B.macro.population ? [e.a, e.b] : [e.b, e.a];
      break;
    }
  }
  expect(strongId).toBeGreaterThanOrEqual(0);
  const setPop = (id: number, pop: number) => {
    const m = w.settlements[id].macro;
    m.population = pop; m.adults = Math.round(pop * 0.7); m.children = Math.round(pop * 0.2); m.elders = pop - m.adults - m.children;
  };
  setPop(strongId, 400);
  setPop(weakId, 60); // 400 > 60 * 1.28 = 76.8 → a decisive conquest
  const strongPolity = w.settlements[strongId].polityId!;
  if (expansionist) w.currentIntent.set(strongPolity, { kind: 'expand' } as OrgIntent); // the aim that TAKES rather than razes
  const edge = w.edges.find((e) => (e.a === strongId && e.b === weakId) || (e.a === weakId && e.b === strongId))!;
  const drive = () => { edge.relation = -100; geographyYearly(w); };
  return { strongId, weakId, strongPolity, weakName: w.settlements[weakId].name, drive };
}

describe('an expansionist victor annexes', () => {
  it('the town survives as a province of the victor, its old dynasty deposed', () => {
    const w = createWorld(123456);
    runYears(w, 6);
    w.orgAgreements = [];
    const { strongId, weakId, strongPolity, weakName, drive } = siege(w, true);
    const oldWeakPolity = w.settlements[weakId].polityId!;
    let annexed = false;
    for (let i = 0; i < 120 && !annexed; i++) {
      drive();
      annexed = w.events.some((e) => e.type === 'annexed' && e.data.annexed === weakName);
    }
    expect(annexed).toBe(true);
    // it was TAKEN, not razed
    expect(w.settlements[weakId].macro.population).toBeGreaterThan(0);
    expect(w.settlements[weakId].ruinedYear).toBeUndefined();
    expect(w.events.some((e) => e.type === 'conquest' && e.data.fallen === weakName)).toBe(false);
    // it now answers to the victor's realm, with no local lord…
    expect(w.settlements[weakId].polityId).toBe(strongPolity);
    expect(w.settlements[weakId].currentRulerId).toBeUndefined();
    // …and its own former polity has fallen
    expect(getOrganization(w, oldWeakPolity)?.dissolvedYear).toBeDefined();
    // a province raises no fresh local dynasty (it is ruled from the capital)
    figuresYearly(w);
    expect(w.settlements[weakId].currentRulerId).toBeUndefined();
    expect(w.settlements[weakId].polityId).toBe(strongPolity);
    expect(strongId).toBeGreaterThanOrEqual(0);
  });
});

describe('a valuable city is taken even by a victor with no expansionist aim', () => {
  it('a substantial town is annexed, not razed — a prize worth ruling', () => {
    const w = createWorld(123456);
    runYears(w, 6);
    w.orgAgreements = [];
    w.currentIntent.clear(); // no 'expand' intent anywhere — value alone drives this
    const { strongId, weakId, weakName, drive } = siege(w, false);
    // make the weaker town a real city (>= the worth-ruling threshold) but still overwhelmed
    const bigPop = 200;
    const setPop = (id: number, pop: number) => {
      const m = w.settlements[id].macro;
      m.population = pop; m.adults = Math.round(pop * 0.7); m.children = Math.round(pop * 0.2); m.elders = pop - m.adults - m.children;
    };
    setPop(weakId, bigPop);
    setPop(strongId, Math.round(bigPop * 1.28) + 120); // still a decisive victor
    let annexed = false;
    for (let i = 0; i < 150 && !annexed; i++) { drive(); annexed = w.events.some((e) => e.type === 'annexed' && e.data.annexed === weakName); }
    expect(annexed).toBe(true);
    expect(w.settlements[weakId].macro.population).toBeGreaterThan(0); // taken, not emptied
  });
});

describe('a poor village with no will to expand is still razed', () => {
  it('the same overwhelming victory empties the small town', () => {
    const w = createWorld(123456);
    runYears(w, 6);
    w.orgAgreements = [];
    w.currentIntent.clear(); // no expansionist aim anywhere
    const { weakId, weakName, drive } = siege(w, false); // siege sets weak = 60, below the worth-ruling threshold
    let decided = false;
    for (let i = 0; i < 200 && !decided; i++) {
      drive();
      decided = w.settlements[weakId].macro.population === 0 ||
        w.events.some((e) => e.type === 'annexed' && e.data.annexed === weakName);
    }
    // razed, never annexed
    expect(w.events.some((e) => e.type === 'conquest' && e.data.fallen === weakName)).toBe(true);
    expect(w.events.some((e) => e.type === 'annexed' && e.data.annexed === weakName)).toBe(false);
  });
});
