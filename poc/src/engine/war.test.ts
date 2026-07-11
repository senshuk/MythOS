/**
 * FORMAL WARS (Phase 2E) — the named, persistent conflicts that emerge when a clash becomes
 * open battle, that allies JOIN by campaign (offense, not merely the alliance's defensive
 * weight), and that resolve with an outcome: a victor's imposed peace when a belligerent
 * falls, or a stalemate when the fighting gutters out. A legibility + resolution layer over
 * the war the world already fights — RNG-free, so a world with no wars is byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears } from './sim';
import { getOrganization } from './organization';
import { declareOrContinueWar, warBetween, joinWar, warYearly, activeWarsOf } from './war';
import { activeAgreement } from './orgInteraction';
import { serializeWorld, deserializeWorld } from './persistence';

/** A forged world plus two distinct living polities to fight, and a third to ally. */
function belligerents(seed = 123456) {
  const w = createWorld(seed);
  runYears(w, 6);
  const orgs = w.organizations.filter((o) => o.dissolvedYear === undefined && o.seatId !== undefined);
  return { w, agg: orgs[0].id, def: orgs[1].id, ally: orgs[2].id };
}

describe('declaring a war', () => {
  it('names a persistent conflict, and a second clash continues it rather than starting a new one', () => {
    const { w, agg, def } = belligerents();
    const before = w.events.length;
    const war = declareOrContinueWar(w, agg, def)!;
    expect(war).toBeDefined();
    expect(w.wars.length).toBe(1);
    expect(w.events.slice(before).some((e) => e.type === 'war_declared')).toBe(true);
    // a later clash between the same pair advances the same war
    w.tick += 100;
    const again = declareOrContinueWar(w, agg, def)!;
    expect(again.id).toBe(war.id);
    expect(w.wars.length).toBe(1);
    expect(again.lastClashTick).toBe(w.tick);
    // warBetween finds it in either orientation
    expect(warBetween(w, def, agg)?.id).toBe(war.id);
  });
});

describe('allies join by campaign', () => {
  it('an ally enrols on its friend\'s side and is recorded entering the war', () => {
    const { w, agg, def, ally } = belligerents();
    const war = declareOrContinueWar(w, agg, def)!;
    const before = w.events.length;
    joinWar(w, war, ally, def); // the ally sides with the defender
    expect(war.sideB).toContain(ally);
    expect(w.events.slice(before).some((e) => e.type === 'war_joined')).toBe(true);
    // joining twice is a no-op (you cannot enter a war you are already in)
    joinWar(w, war, ally, def);
    expect(war.sideB.filter((o) => o === ally).length).toBe(1);
  });
});

describe('resolving a war', () => {
  it('when a primary belligerent falls, the other side wins and imposes peace on the survivors', () => {
    const { w, agg, def, ally } = belligerents();
    const war = declareOrContinueWar(w, agg, def)!;
    joinWar(w, war, ally, def); // the defender has an ally that will survive the defender's fall
    // the defender's seat is razed — its side's primary has fallen
    const defSeat = getOrganization(w, def)!.seatId!;
    w.settlements[defSeat].ruinedYear = Math.floor(w.tick / 365);
    const before = w.events.length;
    warYearly(w);
    expect(w.wars.length).toBe(0); // the war is concluded and removed
    const ended = w.events.slice(before).find((e) => e.type === 'war_ended');
    expect(ended?.data.outcome).toBe('victory');
    // the victor (aggressor) forced the surviving loser (the ally) to a non-aggression peace
    expect(activeAgreement(w, 'non_aggression', agg, ally)).toBeDefined();
  });

  it('a war gone long-quiet gutters out in a stalemate', () => {
    const { w, agg, def } = belligerents();
    declareOrContinueWar(w, agg, def);
    w.tick += 9 * 365; // no fresh clash for nine years — past the quiet window
    const before = w.events.length;
    warYearly(w);
    expect(w.wars.length).toBe(0);
    expect(w.events.slice(before).some((e) => e.type === 'war_ended' && e.data.outcome === 'stalemate')).toBe(true);
  });

  it('leaves an active, still-clashing war alone', () => {
    const { w, agg, def } = belligerents();
    declareOrContinueWar(w, agg, def);
    warYearly(w); // just declared, both sides whole → survives
    expect(w.wars.length).toBe(1);
  });
});

describe('persistence & the NPC guarantee', () => {
  it('wars round-trip through a save', () => {
    const { w, agg, def, ally } = belligerents();
    const war = declareOrContinueWar(w, agg, def)!;
    joinWar(w, war, ally, def);
    const restored = deserializeWorld(serializeWorld(w));
    expect(restored.wars).toEqual(w.wars);
    expect(warBetween(restored, agg, def)?.sideB).toContain(ally);
  });

  it('a fresh world has no wars, and activeWarsOf reports them per polity', () => {
    const { w, agg, def } = belligerents();
    expect(activeWarsOf(w, agg)).toHaveLength(0);
    declareOrContinueWar(w, agg, def);
    expect(activeWarsOf(w, agg)).toHaveLength(1);
    expect(activeWarsOf(w, def)).toHaveLength(1);
  });
});
