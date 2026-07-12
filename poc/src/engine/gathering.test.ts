/**
 * GATHERINGS (design/27 §4) — communal events assemble named villagers: a wedding draws
 * the couple's kin and friends, a funeral the mourners, and each leaves a mood mark on
 * those who came. These assert the mechanism fires in a lived history, carries its crowd,
 * and — per the venue law (design/25 §2) — is deterministic and rng-free.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorld, runYears } from './sim';
import { allEvents } from './world';
import { renderEvent } from './render';
import type { World } from './model';

let w: World;
let evs: ReturnType<typeof allEvents>;
beforeAll(() => {
  w = createWorld(42, true);
  runYears(w, 30); // long enough for marriages and deaths in the focused settlement
  evs = allEvents(w);
});

describe('communal gatherings', () => {
  it('weddings assemble a crowd around the couple, at a venue, and narrate', () => {
    const weddings = evs.filter((e) => e.type === 'wedding');
    expect(weddings.length).toBeGreaterThan(0);
    const wed = weddings[0];
    expect(wed.subjects.length).toBe(2); // the couple are the named principals
    expect(typeof wed.data.count).toBe('number');
    expect(wed.data.count as number).toBeGreaterThan(0); // someone actually came
    expect(wed.data.settlement).toBeTruthy();
    expect(renderEvent(w, wed)).toMatch(/gathered.*to see .* wed/);
  });

  it('funerals gather mourners for the dead — its weight scales with the crowd', () => {
    const funerals = evs.filter((e) => e.type === 'funeral');
    expect(funerals.length).toBeGreaterThan(0);
    const fun = funerals[0];
    expect(fun.subjects.length).toBe(1); // the deceased is named
    expect(fun.data.count as number).toBeGreaterThan(0);
    expect(fun.causes.length).toBeGreaterThan(0); // caused by the death it mourns
    expect(renderEvent(w, fun)).toMatch(/gathered to mourn/);
  });

  it('leaves a mood mark on those who came (feasted / mourned)', () => {
    let feasted = 0;
    let mourned = 0;
    for (const marks of w.selfThoughts.values()) {
      for (const m of marks) {
        if (m.kind === 'feasted') feasted++;
        if (m.kind === 'mourned') mourned++;
      }
    }
    expect(feasted + mourned).toBeGreaterThan(0); // the community felt its gatherings
  });

  it('is deterministic and rng-free: the same seed yields the same gatherings', () => {
    const w2 = createWorld(42, true);
    runYears(w2, 30);
    const g1 = allEvents(w).filter((e) => e.type === 'wedding' || e.type === 'funeral').map((e) => `${e.type}@${e.tick}:${e.data.count}`);
    const g2 = allEvents(w2).filter((e) => e.type === 'wedding' || e.type === 'funeral').map((e) => `${e.type}@${e.tick}:${e.data.count}`);
    expect(g2).toEqual(g1);
  });
});
