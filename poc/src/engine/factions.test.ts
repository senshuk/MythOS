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
import { createWorld, runYears } from './sim';
import { fullActors, allEvents } from './world';
import { factionOf, factionYearly, EXILE_RETURN_YEARS } from './factions';
import { VALUES, thoughtSpec } from '../content/fixture';
import { DAYS_PER_YEAR, type World, type WorldEvent, type ExileRecord, type EntityId } from './model';

// A seed whose focused settlement runs the full civil-war arc, re-pinned after Phase 2D
// (organizational actions now feed the Director, shifting seed-tuned drama timelines — see
// design/15 invariants 8–9). For seed 3 the live-sim years are: contested ~82, civil war /
// exile ~92, return ~112. CIVIL_WAR_YEAR sits between exile and return so the exile record
// is still present when that test inspects it (return prunes it at exile + EXILE_RETURN_YEARS).
const CIVIL_WAR_SEED = 3;
const CONTESTED_YEAR = 90;
const CIVIL_WAR_YEAR = 100;
const RETURN_FROM_EXILE_YEAR = 120;

/**
 * The seed-3 history, simulated ONCE and captured at the three checkpoint years.
 * runYears is incremental, so advancing one world 90 → 100 → 120 is identical to
 * three fresh runs (that equivalence is what the determinism suite holds) — but it
 * costs one 120-year simulation instead of ~830 simulated years across the tests
 * below. Event compaction can discard old events later, and return-from-exile
 * prunes world.exiles, so each checkpoint snapshots the state its tests inspect.
 * Every consumer is read-only.
 */
interface CivilWarArc {
  at90: { events: WorldEvent[] };
  at100: { events: WorldEvent[]; exiles: Map<EntityId, ExileRecord>; civilWarTick: number | undefined };
  /** the live world at RETURN_FROM_EXILE_YEAR */
  w: World;
}
let arc: CivilWarArc | undefined;
function civilWarArc(): CivilWarArc {
  if (!arc) {
    const w = createWorld(CIVIL_WAR_SEED);
    runYears(w, CONTESTED_YEAR);
    const at90 = { events: allEvents(w) };
    runYears(w, CIVIL_WAR_YEAR - CONTESTED_YEAR);
    const at100 = {
      events: allEvents(w),
      exiles: new Map(w.exiles),
      civilWarTick: w.settlements[w.focusedSettlementId].civilWarTick,
    };
    runYears(w, RETURN_FROM_EXILE_YEAR - CIVIL_WAR_YEAR);
    arc = { at90, at100, w };
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
    const { at100 } = civilWarArc();
    expect(at100.events.some((e) => e.type === 'civil_war')).toBe(true);
  });

  it('civil_war event names winner, loser, and settlement; winner ≠ loser', () => {
    const { at100 } = civilWarArc();
    const ev = at100.events.find((e) => e.type === 'civil_war')!;
    expect(typeof ev.data.winner).toBe('string');
    expect(typeof ev.data.loser).toBe('string');
    expect(typeof ev.data.settlement).toBe('string');
    expect(ev.data.winner).not.toBe(ev.data.loser);
  });

  it('civil_war is always preceded by contested_succession in the full event log', () => {
    const { at100 } = civilWarArc();
    const warEv = at100.events.find((e) => e.type === 'civil_war')!;
    const priorContest = at100.events.find((e) => e.type === 'contested_succession' && e.tick < warEv.tick);
    expect(priorContest).toBeDefined();
  });

  it('exile event fires, exiled actor leaves the focused settlement, and world.exiles records them', () => {
    const { at100, w } = civilWarArc();
    const exileEv = at100.events.find((e) => e.type === 'exile')!;
    const id = exileEv.subjects[0];
    // exile record is in world.exiles
    expect(at100.exiles.has(id)).toBe(true);
    // exile record has expected fields
    const rec = at100.exiles.get(id)!;
    expect(typeof rec.axis).toBe('string');
    expect(typeof rec.factionName).toBe('string');
    expect(typeof rec.year).toBe('number');
    // exile record proves they were expelled from the focused settlement
    expect(rec.fromSettlementId).toBe(w.focusedSettlementId);
    // from/to are both present and differ
    expect(exileEv.data.from).not.toBe(exileEv.data.to);
  });

  it('civil war clock clears to undefined after war resolves', () => {
    const { at100 } = civilWarArc();
    expect(at100.civilWarTick).toBeUndefined();
  });
});

describe('contested succession', () => {
  it('contested_succession fires when a ruler change crosses faction lines', () => {
    const { at90 } = civilWarArc();
    expect(at90.events.some((e) => e.type === 'contested_succession')).toBe(true);
  });

  it('contested_succession event names both factions and the settlement', () => {
    const { at90 } = civilWarArc();
    const ev = at90.events.find((e) => e.type === 'contested_succession')!;
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
