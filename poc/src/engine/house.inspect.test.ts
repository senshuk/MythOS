/**
 * A HOUSE is now a first-class, inspectable thing: inspectHouse assembles the dynasty's
 * founder, its line of members, and its saga; and "House X" in event prose links to it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorld, runYears, inspectHouse } from './sim';
import { renderEventParts } from './render';
import { getEvent } from './world';
import type { World } from './model';

let w: World;
beforeAll(() => {
  w = createWorld(7, true);
  runYears(w, 45);
});

describe('inspectHouse — the dynasty made inspectable', () => {
  it('assembles a House from its founder, line, and saga', () => {
    expect(w.houses.length).toBeGreaterThan(0);
    const house = w.houses[0];
    const d = inspectHouse(w, house.id)!;
    expect(d).toBeDefined();
    expect(d.name).toBe(house.name);
    expect(d.founder?.id).toBe(house.founderId); // the founder resolves to a figure
    expect(d.members.length).toBeGreaterThan(0); // at least the founder is in the line
    expect(d.members.every((m) => w.figuresById.has(m.id))).toBe(true); // every member inspectable
    expect(inspectHouse(w, house.id)).toEqual(d); // deterministic
    expect(inspectHouse(w, 9_999_999)).toBeUndefined(); // unknown → nothing
  });

  it('links "House X" in event prose to the dynasty', () => {
    // find any event whose prose names a House, and confirm that run carries a house ref
    let linked = false;
    for (const ev of [...w.events].reverse()) {
      const houseName = (ev.data.house ?? ev.data.old) as string | undefined;
      if (!houseName) continue;
      const parts = renderEventParts(w, ev);
      if (parts.some((p) => p.ref?.kind === 'house')) { linked = true; break; }
    }
    // if a House-naming event exists this run, its prose must link the House
    const anyHouseEvent = [...w.events].some((e) => e.data.house !== undefined || e.data.old !== undefined);
    if (anyHouseEvent) expect(linked).toBe(true);
    // and the ref a prose link carries actually resolves
    for (const ev of w.events) {
      for (const p of renderEventParts(w, ev)) {
        if (p.ref?.kind === 'house') expect(inspectHouse(w, p.ref.id)).toBeDefined();
      }
    }
    void getEvent; // (kept: archive-aware fetch, if a future assertion needs it)
  });
});
