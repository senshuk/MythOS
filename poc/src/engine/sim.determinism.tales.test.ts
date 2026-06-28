/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, buildSnapshot, focusSettlement } from './sim';
import { summaryActors, fullActors } from './world';
import { interestOf } from './chronicle';
import { type WorldEvent, type EventType } from './model';

describe('summary tier + migration', () => {
  it('a summary actor keeps its identity when its settlement is re-focused', () => {
    const w = createWorld(11);
    runYears(w, 30);
    focusSettlement(w, 4); // settlement 0 demotes; its notables become summaries
    const survivor = summaryActors(w).find((id) => w.homeSettlement.get(id) === 0);
    expect(survivor).toBeDefined();
    const nameBefore = w.identity.get(survivor!)!.given;
    focusSettlement(w, 0); // back home — the summary should upgrade to full, same id
    expect(w.fidelity.get(survivor!)).toBe('full');
    expect(w.lifecycle.get(survivor!)!.alive).toBe(true);
    expect(w.identity.get(survivor!)!.given).toBe(nameBefore);
  });

  it('migration produces named people living across the world', () => {
    // Emigration moves named people out of the focused settlement to live elsewhere as
    // summary-tier actors. Summaries churn and die (cap per settlement), so any SINGLE
    // seed may momentarily have none at year 40 — assert the property holds across seeds.
    let found = false;
    for (let s = 1; s < 25 && !found; s++) {
      const w = createWorld(s);
      runYears(w, 40);
      const elsewhere = summaryActors(w).filter((id) => w.homeSettlement.get(id) !== w.focusedSettlementId);
      if (w.events.some((e) => e.type === 'emigrated') && elsewhere.length > 0) found = true;
    }
    expect(found).toBe(true);
  });

  it('live entities = full + summary, and stay bounded vs the world population', () => {
    const w = createWorld(7);
    runYears(w, 40);
    const snap = buildSnapshot(w);
    const alive = w.entities.filter((id) => w.lifecycle.get(id)!.alive).length;
    expect(alive).toBe(snap.simulatedInDetail + snap.namedPeople);
    expect(alive).toBeLessThan(snap.worldPopulation);
  });

  it('full actors reside in the focused settlement; summaries do not', () => {
    const w = createWorld(123);
    runYears(w, 25);
    for (const id of fullActors(w)) expect(w.homeSettlement.get(id)).toBe(w.focusedSettlementId);
    for (const id of summaryActors(w)) expect(w.homeSettlement.get(id)).not.toBe(w.focusedSettlementId);
  });
});

describe('chronicle (tales)', () => {
  const mk = (type: EventType, data: Record<string, number | string> = {}): WorldEvent => ({
    id: 1,
    tick: 0,
    year: 0,
    type,
    subjects: [],
    data,
    causes: [],
  });

  it('interest scoring elevates dramatic events over routine ones', () => {
    expect(interestOf(mk('died_brawl'))).toBeGreaterThan(interestOf(mk('born')));
    expect(interestOf(mk('famine', { toll: 20 }))).toBeGreaterThan(interestOf(mk('married')));
    expect(interestOf(mk('feud'))).toBeGreaterThan(interestOf(mk('kindness')));
    expect(interestOf(mk('born'))).toBe(0); // routine — not remembered
  });

  it('the chronicle stays bounded and records the memorable past as legends', () => {
    const w = createWorld(42);
    runYears(w, 60);
    expect(w.chronicle.length).toBeGreaterThan(0);
    expect(w.chronicle.length).toBeLessThanOrEqual(60); // bounded
    const snap = buildSnapshot(w);
    expect(snap.chronicle.length).toBeGreaterThan(0);
    expect(snap.chronicle[0].text.length).toBeGreaterThan(0); // a rendered legend
  });

  it('named years are dramatic and deterministic', () => {
    const run = () => {
      const w = createWorld(42);
      runYears(w, 60);
      return buildSnapshot(w);
    };
    const a = run();
    const b = run();
    expect(a.eras).toEqual(b.eras); // reproducible
    expect(a.eras.length).toBeGreaterThan(0); // a lively world names some years
  });
});
