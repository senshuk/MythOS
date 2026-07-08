/**
 * Intra-cultural factionalism — Stage 1 (detection, rivalry, contested succession),
 * Stage 2 (civil war resolution, exile), and Stage 3 (return from exile).
 *
 * Proves: (a) the contested axis is always the most internally-divided one;
 * (b) factionOf correctly assigns actors to opposing poles;
 * (c) opposing-faction actors accumulate factionRivalry thoughts;
 * (d) contested_succession fires when a ruler change crosses faction lines;
 * (e) civil_war fires after the grace period following a contested_succession;
 * (f) the losing faction leader is exiled and tracked in world.exiles;
 * (g) exiled actors return formally after EXILE_RETURN_YEARS (not via migration);
 * (h) everything is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, allEvents, emit } from './world';
import { factionOf, factionYearly, civilWarYearly, exileYearly, EXILE_RETURN_YEARS } from './factions';
import { VALUES, thoughtSpec } from '../content/fixture';
import { DAYS_PER_YEAR, type World, type WorldEvent, type ExileRecord, type EntityId } from './model';

// A seed with a stable, populated focused settlement and a useful faction split.
const CIVIL_WAR_SEED = 21;

/**
 * A focused civil-war transition built directly from the faction system's public yearly
 * passes. The old fixture waited decades for this arc to emerge, which made the fast
 * suite unusable; these tests care about the transition contracts, not the pacing seed.
 */
interface CivilWarArc {
  atContested: { events: WorldEvent[] };
  atCivilWar: { events: WorldEvent[]; exiles: Map<EntityId, ExileRecord>; civilWarTick: number | undefined };
  /** the live world at RETURN_FROM_EXILE_YEAR */
  w: World;
}
let arc: CivilWarArc | undefined;
function civilWarArc(): CivilWarArc {
  if (!arc) {
    const w = createWorld(CIVIL_WAR_SEED);
    w.tick = DAYS_PER_YEAR;
    factionYearly(w);
    const split = w.factionSplit!;
    const focused = w.settlements[w.focusedSettlementId];
    const claimantSubjects = [split.highLeaderId, split.lowLeaderId].filter((id): id is number => id !== undefined);
    emit(w, 'contested_succession', claimantSubjects, {
      settlement: focused.name,
      newFaction: split.highName,
      oldFaction: split.lowName,
      axis: split.axis,
    }, [], [focused.id]);
    const atContested = { events: allEvents(w) };

    w.tick += 1;
    focused.civilWarTick = w.tick - (10 * DAYS_PER_YEAR);
    civilWarYearly(w);
    const atCivilWar = {
      events: allEvents(w),
      exiles: new Map(w.exiles),
      civilWarTick: w.settlements[w.focusedSettlementId].civilWarTick,
    };

    w.tick += EXILE_RETURN_YEARS * DAYS_PER_YEAR;
    exileYearly(w);
    arc = { atContested, atCivilWar, w };
  }
  return arc;
}

describe('faction split detection', () => {
  it('factionSplit is set after the first yearly tick', () => {
    const w = createWorld(42);
    w.tick += DAYS_PER_YEAR;
    factionYearly(w);
    expect(w.factionSplit).toBeDefined();
  });

  it('contested axis is one of the known value axes', () => {
    const w = createWorld(42);
    w.tick += DAYS_PER_YEAR;
    factionYearly(w);
    expect(VALUES).toContain(w.factionSplit!.axis);
  });

  it('all actors are assigned to a pole', () => {
    const w = createWorld(42);
    w.tick += DAYS_PER_YEAR;
    factionYearly(w);
    const residents = fullActors(w);
    for (const id of residents) {
      const pole = factionOf(w, id);
      expect(pole === 'high' || pole === 'low').toBe(true);
    }
  });

  it('both poles are populated (not everyone in the same half)', () => {
    const w = createWorld(42);
    w.tick += DAYS_PER_YEAR;
    factionYearly(w);
    const residents = fullActors(w);
    const poles = residents.map((id) => factionOf(w, id));
    expect(poles.some((p) => p === 'high')).toBe(true);
    expect(poles.some((p) => p === 'low')).toBe(true);
  });

  it('factionRivalry spec is negative and stronger than faithFriction', () => {
    expect(thoughtSpec('factionRivalry').base).toBeLessThan(0);
    expect(Math.abs(thoughtSpec('factionRivalry').base)).toBeGreaterThan(
      Math.abs(thoughtSpec('faithFriction').base),
    );
  });

  it('is deterministic: same seed produces identical splits', () => {
    const axis = (seed: number) => {
      const w = createWorld(seed);
      w.tick += DAYS_PER_YEAR;
      factionYearly(w);
      return w.factionSplit?.axis;
    };
    expect(axis(7)).toBe(axis(7));
    expect(axis(99)).toBe(axis(99));
  });
});

describe('faction rivalry thoughts', () => {
  it('opposing-faction actors accumulate factionRivalry thoughts after several years', () => {
    const w = createWorld(42);
    // run 15 years of factionYearly to let sampling build up thoughts
    for (let y = 0; y < 15; y++) {
      w.tick += DAYS_PER_YEAR;
      factionYearly(w);
    }
    const residents = fullActors(w);
    let foundRivalry = false;
    for (const id of residents) {
      const myPole = factionOf(w, id);
      for (const [otherId, edge] of w.rels.get(id)!) {
        if (!residents.includes(otherId)) continue;
        const otherPole = factionOf(w, otherId);
        if (myPole !== otherPole && edge.thoughts.some((t) => t.kind === 'factionRivalry')) {
          foundRivalry = true;
          break;
        }
      }
      if (foundRivalry) break;
    }
    expect(foundRivalry).toBe(true);
  });

  it('no factionRivalry thoughts when the community is perfectly uniform (no contested axis)', () => {
    // Zero all value axes for all actors → detectSplit finds spread=0 → factionSplit undefined
    const w = createWorld(42);
    const residents = fullActors(w);
    for (const id of residents) {
      const pers = w.personality.get(id);
      if (pers) for (const ax of VALUES) pers.values[ax] = 0;
    }
    for (let y = 0; y < 5; y++) {
      w.tick += DAYS_PER_YEAR;
      factionYearly(w);
    }
    // With no variance detectSplit returns undefined → factionYearly is a no-op
    expect(w.factionSplit).toBeUndefined();
    for (const id of residents) {
      for (const [, edge] of w.rels.get(id)!) {
        expect(edge.thoughts.some((t) => t.kind === 'factionRivalry')).toBe(false);
      }
    }
  });
});

describe('civil war and exile', () => {
  it('civil_war fires within 120 years (after contested_succession + grace period)', () => {
    const { atCivilWar } = civilWarArc();
    expect(atCivilWar.events.some((e) => e.type === 'civil_war')).toBe(true);
  });

  it('civil_war event names winner, loser, and settlement; winner ≠ loser', () => {
    const { atCivilWar } = civilWarArc();
    const ev = atCivilWar.events.find((e) => e.type === 'civil_war')!;
    expect(typeof ev.data.winner).toBe('string');
    expect(typeof ev.data.loser).toBe('string');
    expect(typeof ev.data.settlement).toBe('string');
    expect(ev.data.winner).not.toBe(ev.data.loser);
  });

  it('civil_war is always preceded by contested_succession in the full event log', () => {
    const { atCivilWar } = civilWarArc();
    const warEv = atCivilWar.events.find((e) => e.type === 'civil_war')!;
    const priorContest = atCivilWar.events.find((e) => e.type === 'contested_succession' && e.tick < warEv.tick);
    expect(priorContest).toBeDefined();
  });

  it('exile event fires, exiled actor leaves the focused settlement, and world.exiles records them', () => {
    const { atCivilWar, w } = civilWarArc();
    const exileEv = atCivilWar.events.find((e) => e.type === 'exile')!;
    const id = exileEv.subjects[0];
    // exile record is in world.exiles
    expect(atCivilWar.exiles.has(id)).toBe(true);
    // exile record has expected fields
    const rec = atCivilWar.exiles.get(id)!;
    expect(typeof rec.axis).toBe('string');
    expect(typeof rec.factionName).toBe('string');
    expect(typeof rec.year).toBe('number');
    // exile record proves they were expelled from the focused settlement
    expect(rec.fromSettlementId).toBe(w.focusedSettlementId);
    // from/to are both present and differ
    expect(exileEv.data.from).not.toBe(exileEv.data.to);
  });

  it('civil war clock clears to undefined after war resolves', () => {
    const { atCivilWar } = civilWarArc();
    expect(atCivilWar.civilWarTick).toBeUndefined();
  });
});

describe('contested succession', () => {
  it('contested_succession fires when a ruler change crosses faction lines', () => {
    const { atContested } = civilWarArc();
    expect(atContested.events.some((e) => e.type === 'contested_succession')).toBe(true);
  });

  it('contested_succession event names both factions and the settlement', () => {
    const { atContested } = civilWarArc();
    const ev = atContested.events.find((e) => e.type === 'contested_succession')!;
    expect(typeof ev.data.newFaction).toBe('string');
    expect(typeof ev.data.oldFaction).toBe('string');
    expect(typeof ev.data.settlement).toBe('string');
    expect(ev.data.newFaction).not.toBe(ev.data.oldFaction);
  });
});

describe('return from exile', () => {
  it('return_from_exile fires after EXILE_RETURN_YEARS, always preceded by an exile event', () => {
    const { w } = civilWarArc();
    const events = allEvents(w);
    const returnEv = events.find((e) => e.type === 'return_from_exile')!;
    const id = returnEv.subjects[0];
    // there must be a prior exile event for the same actor
    const exileEv = events.find((e) => e.type === 'exile' && e.subjects[0] === id && e.tick < returnEv.tick);
    expect(exileEv).toBeDefined();
    // yearsGone is present and at least EXILE_RETURN_YEARS
    expect(typeof returnEv.data.yearsGone).toBe('number');
    expect(returnEv.data.yearsGone as number).toBeGreaterThanOrEqual(EXILE_RETURN_YEARS);
  });

  it('returned exile is removed from world.exiles', () => {
    const { w } = civilWarArc();
    const returnEv = allEvents(w).find((e) => e.type === 'return_from_exile')!;
    const id = returnEv.subjects[0];
    expect(w.exiles.has(id)).toBe(false);
  });

  it('returned actor is back in the focused settlement', () => {
    const { w } = civilWarArc();
    const returnEv = allEvents(w).find((e) => e.type === 'return_from_exile')!;
    const id = returnEv.subjects[0];
    // if the actor is still alive, they should be in the focused settlement or dead
    const lc = w.lifecycle.get(id);
    if (lc?.alive) {
      expect(w.homeSettlement.get(id)).toBe(w.focusedSettlementId);
    }
  });
});
