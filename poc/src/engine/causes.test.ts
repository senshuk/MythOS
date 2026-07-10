/**
 * CAUSAL DENSITY: the political/dynastic events players most ask "why?" about now carry
 * their causes, so inspectEvent traces a real chain instead of "nothing caused it". These
 * hold the newly-threaded chains: a ruler's death → the succession it triggers, and a razed
 * city → its House's fall → its polity's dissolution.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorld, runYears, inspectEvent } from './sim';
import { allEvents } from './world';
import type { World } from './model';

// one shared world (a settlement-rich seed, run long enough for a death-succession and a
// razing) — worldgen is the costly part, so both chains are read from the same history.
let w: World;
let evs: ReturnType<typeof allEvents>;
beforeAll(() => {
  w = createWorld(42, true);
  runYears(w, 28);
  evs = allEvents(w);
});

describe('causal density — why did this happen?', () => {
  it("a ruler's death causes the succession that follows it", () => {
    const succ = evs.find((e) => (e.type === 'ascension' || e.type === 'dynasty') && e.causes.length > 0);
    expect(succ).toBeDefined();
    const chain = inspectEvent(w, succ!.id)!;
    expect(chain.ancestors.some((a) => a.event.type === 'ruler_died')).toBe(true); // traceable to the death
  });

  it('a razed city fells its ruling House, which dissolves its polity — a traceable collapse', () => {
    const fallen = evs.find((e) => e.type === 'house_fallen' && e.causes.length > 0);
    expect(fallen).toBeDefined();
    // the House fell because the city fell (a ruin or a conquest)
    const fchain = inspectEvent(w, fallen!.id)!;
    expect(fchain.ancestors.some((a) => a.event.type === 'ruined' || a.event.type === 'conquest')).toBe(true);
    // and the polity dissolved because the House fell
    const dissolved = evs.find((e) => e.type === 'polity_dissolved' && e.causes.includes(fallen!.id));
    expect(dissolved).toBeDefined();
  });
});
