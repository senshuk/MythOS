/**
 * BACKSTORIES are assembled from an actor's REAL history, so every one is TRUE to the world:
 * the lineage clause matches the House's actual fortune, the birthplace's fate shows, the opener
 * is the actor's own name, and the same soul always reads the same (presentation, stable).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorld, runYears, inspectActor } from './sim';
import { fullActors } from './world';
import { Rng } from './rng';
import { renderBackstory } from '../content/narrative';
import type { BackstoryFacts } from './backstory';
import type { World } from './model';

// the pure renderer, exercised over synthetic facts — every clause branch, deterministically
describe('renderBackstory — every clause is grounded in a fact', () => {
  const base: BackstoryFacts = {
    given: 'Korth', house: 'Nebath', houseFate: 'ended', cultureId: 'martial',
    bornYear: 212, place: 'Dunhold', placeFate: 'razed', profession: 'smith',
    dominantValue: 'craft', era: { type: 'famine', year: 212, data: {} }, orphaned: true,
  };
  const render = (f: Partial<BackstoryFacts>) => renderBackstory({ ...base, ...f }, new Rng(1));

  it('names the lineage by its true fortune', () => {
    expect(render({ houseFate: 'ended' })).toContain('last of House Nebath');
    expect(render({ houseFate: 'ruling' })).toContain('ruling House Nebath');
    expect(render({ houseFate: 'fallen' })).toContain('House Nebath, fallen');
    expect(render({ houseFate: 'founding' })).toContain('founder of House Nebath');
    expect(render({ house: undefined, houseFate: 'lowborn' })).toContain('of common birth');
  });

  it('shows the birthplace fate, the formative era, and orphanhood', () => {
    const s = render({});
    expect(s.startsWith('Korth')).toBe(true);
    expect(s).toContain('Dunhold, now a ruin');
    expect(s).toContain('famine of y212');
    expect(s.toLowerCase()).toContain('orphaned young');
    expect(s).toMatch(/make and to mend|pride in good work/); // the craft bent
    // an ordinary childhood gets no era clause (not a bland "in the days of yN")
    expect(render({ era: undefined, orphaned: false, placeFate: 'ordinary' })).not.toMatch(/came of age|grew up|came up/);
  });
});

// integration: real actors, real world
describe('backstories are true to the world', () => {
  let w: World;
  beforeAll(() => {
    w = createWorld(7, true);
    runYears(w, 45);
  });

  it("open with the actor's name and match their House's real fortune", () => {
    for (const id of fullActors(w)) {
      if (!w.lifecycle.get(id)!.alive) continue;
      const d = inspectActor(w, id)!;
      const idn = w.identity.get(id)!;
      expect(d.backstory.startsWith(idn.given)).toBe(true);
      const house = w.houses.find((h) => h.name === idn.family);
      if (!house) expect(d.backstory).toContain('of common birth');
      else if (house.founderId === id) expect(d.backstory).toContain(`founder of House ${house.name}`);
      else if (house.extinctYear !== undefined) expect(d.backstory).toContain(`last of House ${house.name}`);
      else if (house.seatSettlementId !== undefined) expect(d.backstory).toContain(`ruling House ${house.name}`);
      else expect(d.backstory).toContain(`House ${house.name}, fallen`);
    }
  });

  it('are stable — the same actor reads the same story', () => {
    const id = fullActors(w).find((a) => w.lifecycle.get(a)!.alive)!;
    expect(inspectActor(w, id)!.backstory).toBe(inspectActor(w, id)!.backstory);
  });
});
