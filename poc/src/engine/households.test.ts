/**
 * Households (design/24 L2) — a pure READING of the ties the sim already keeps:
 * wedded couples share a hearth, the unwed live under their parents' roof, everyone
 * else keeps their own. These tests pin the partition invariants and determinism
 * against a real focused world.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, buildHouseholds } from './sim';
import { fullActors } from './world';

// ONE shared world fixture (test-suite convention). A few live years so births exist —
// at the plain-init baseline actors are minted with spouses but no parent ties yet.
const W = createWorld(123456);
runYears(W, 4);
const SID = W.focusedSettlementId;

describe('buildHouseholds — who lives under one roof', () => {
  it('is deterministic: same ties ⇒ the same households', () => {
    expect(JSON.stringify(buildHouseholds(W, SID))).toBe(JSON.stringify(buildHouseholds(W, SID)));
  });

  it('partitions every living full actor into exactly one household', () => {
    const households = buildHouseholds(W, SID);
    const seen = new Map<number, number>();
    for (const h of households) for (const m of h.members) seen.set(m.id, (seen.get(m.id) ?? 0) + 1);
    const living = fullActors(W).filter((a) => W.lifecycle.get(a)?.alive);
    expect(seen.size).toBe(living.length);
    for (const [, n] of seen) expect(n).toBe(1);
  });

  it('wedded couples share a hearth', () => {
    const households = buildHouseholds(W, SID);
    const homeOf = new Map<number, number>();
    households.forEach((h, i) => h.members.forEach((m) => homeOf.set(m.id, i)));
    let couples = 0;
    for (const h of households) {
      for (const m of h.members) {
        for (const sp of W.ties.get(m.id)?.spouses ?? []) {
          if (homeOf.has(sp)) {
            expect(homeOf.get(sp)).toBe(homeOf.get(m.id));
            couples++;
          }
        }
      }
    }
    expect(couples).toBeGreaterThan(0); // the fixture town has marriages
  });

  it('an unwed child lives under a parent\'s roof', () => {
    const households = buildHouseholds(W, SID);
    const homeOf = new Map<number, number>();
    households.forEach((h, i) => h.members.forEach((m) => homeOf.set(m.id, i)));
    let checked = 0;
    for (const id of fullActors(W)) {
      const t = W.ties.get(id);
      if (!t || t.spouses.length > 0 || !homeOf.has(id)) continue;
      // parents may live APART (widowed, remarried) — the child joins ONE of them
      const parentHomes = t.parents.map((p) => homeOf.get(p)).filter((h): h is number => h !== undefined);
      if (parentHomes.length === 0) continue;
      expect(parentHomes).toContain(homeOf.get(id));
      checked++;
    }
    expect(checked).toBeGreaterThan(0); // the fixture town has children at home
  });

  it('the head is the eldest, and names the household', () => {
    for (const h of buildHouseholds(W, SID).slice(0, 20)) {
      expect(h.members[0].role).toBe('head');
      const eldest = Math.max(...h.members.map((m) => m.ageYears));
      expect(h.members[0].ageYears).toBe(eldest);
      expect(h.family.length).toBeGreaterThan(0);
    }
  });

  it('anywhere but the focused settlement is not lived in full: []', () => {
    const other = W.settlements.find((s) => s.id !== SID)!;
    expect(buildHouseholds(W, other.id)).toEqual([]);
  });
});
