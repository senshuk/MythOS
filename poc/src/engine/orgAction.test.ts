/**
 * Phase 2D: organizations EXECUTE intent. These tests hold the execution-layer contract:
 *  - resolve() is pure (decides + describes; mutates nothing); applyEffects() mutates.
 *  - feasibility gates execution; an infeasible attempt is not history.
 *  - a successful action changes the ORG (clamped) and records history — never geography.
 *  - actions respect a cooldown, and the whole pass is deterministic + persisted.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, hashWorld } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { orgActionYearly, applyEffects, actionForIntent, operationalOf } from './orgAction';
import { allEvents } from './world';
import { SUBSISTENCE_RESOURCE, baselineOperational } from '../content/fixture';
import type { World, Organization } from './model';

const roundTrip = (w: World): World => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));

/** A living polity org with a seat. */
function aPolity(w: World): Organization {
  const org = w.organizations.find((o) => o.dissolvedYear === undefined && o.seatId !== undefined);
  if (!org) throw new Error('no polity with a seat');
  return org;
}

describe('Execution: decide vs apply', () => {
  it('resolve() is pure — it describes effects but mutates nothing', () => {
    const w = createWorld(1);
    const org = aPolity(w);
    const seat = w.settlements[org.seatId!];
    seat.econ.wealth = 100; // make the festival feasible
    seat.econ.stock[SUBSISTENCE_RESOURCE] = seat.macro.population * 5;
    const action = actionForIntent('remain_neutral')!; // hold_festival
    const opsBefore = { ...operationalOf(w, org.id) };
    const wealthBefore = seat.econ.wealth;
    const stabBefore = seat.macro.stability;

    const outcome = action.resolve(w, org, operationalOf(w, org.id));
    expect(outcome.effects.length).toBeGreaterThan(0); // it DESCRIBES changes…
    expect(operationalOf(w, org.id)).toEqual(opsBefore); // …but applied none
    expect(seat.econ.wealth).toBe(wealthBefore);
    expect(seat.macro.stability).toBe(stabBefore);
  });

  it('applyEffects mutates and clamps', () => {
    const w = createWorld(2);
    const org = aPolity(w);
    const ops = operationalOf(w, org.id);
    ops.strength = 95;
    applyEffects(w, org, [{ target: 'stat', key: 'strength', delta: 20 }]);
    expect(ops.strength).toBe(100); // clamped to [0,100]
    const seat = w.settlements[org.seatId!];
    seat.econ.wealth = 10;
    applyEffects(w, org, [{ target: 'wealth', delta: -50 }]);
    expect(seat.econ.wealth).toBe(0); // clamped to ≥ 0
  });
});

describe('Execution: feasibility gates history', () => {
  it('an infeasible action is rejected (no food → cannot recruit; no funds → cannot pay)', () => {
    const w = createWorld(3);
    const org = aPolity(w);
    const seat = w.settlements[org.seatId!];
    const recruit = actionForIntent('recruit')!;
    w.orgTreasury.set(org.id, 25); // funded — food is the gate under test first
    seat.econ.stock[SUBSISTENCE_RESOURCE] = 0;
    expect(recruit.feasible(w, org, operationalOf(w, org.id)).ok).toBe(false);
    seat.econ.stock[SUBSISTENCE_RESOURCE] = seat.macro.population * 5; // ~5 years' buffer
    expect(recruit.feasible(w, org, operationalOf(w, org.id)).ok).toBe(true);
    // 2C: the levies must also be PAID — a penniless treasury blocks the same action
    w.orgTreasury.set(org.id, 0);
    expect(recruit.feasible(w, org, operationalOf(w, org.id)).ok).toBe(false);
  });
});

describe('Execution: actions are org-only history', () => {
  it('a yearly pass records history but changes no geography', () => {
    const w = createWorld(123456); // settlement-rich world → polities that can afford to act
    const geoStr = () => w.settlements.map((s) => `${s.id}:${s.pos.x},${s.pos.y}:${s.ruinedYear ?? -1}`);
    // run year by year (orgs accrue the funds/food an action needs) until a pass produces
    // outcome events — a reshaped world's polities may need a few years before any can act.
    let geoBefore = geoStr();
    let acted = false;
    for (let y = 0; y < 25 && !acted; y++) {
      runYears(w, 1);
      geoBefore = geoStr();
      const evBefore = w.events.length;
      w.lastAction.clear(); // clear cooldowns so feasible orgs act this call
      orgActionYearly(w);
      acted = w.events.length > evBefore;
    }

    expect(acted).toBe(true); // some org acted → outcome events
    expect(w.settlements.length).toBe(geoBefore.length); // geography untouched…
    expect(geoStr()).toEqual(geoBefore);
    // the new events are organizational action outcomes
    expect(allEvents(w).some((e) => e.type.startsWith('org_'))).toBe(true);
  });

  it('a successful action moves the org off its operational baseline', () => {
    const w = createWorld(4);
    const base = baselineOperational();
    // run until SOME org succeeds at an action (feasibility depends on each seat's
    // wealth/food, so the first feasible year varies by world) — bounded, not seed-lucky
    let moved = false;
    for (let y = 0; y < 10 && !moved; y++) {
      runYears(w, 1);
      moved = [...w.operationalState.values()].some((ops) =>
        Object.keys(base).some((k) => ops[k] !== base[k]),
      );
    }
    expect(moved).toBe(true);
  });
});

describe('Execution: cooldown, determinism, persistence', () => {
  it('an org does not act again within its cooldown', () => {
    let w = createWorld(5);
    // advance until some org has executed an action
    let entry: [number, World['lastAction'] extends Map<number, infer V> ? V : never] | undefined;
    for (let y = 0; y < 12 && !entry; y++) {
      runYears(w, 1);
      entry = [...w.lastAction.entries()].find(([, a]) => a.outcome === 'success');
    }
    expect(entry).toBeDefined();
    const [orgId, action] = entry!;
    const firstTick = action.sinceTick;
    runYears(w, 1); // one more year — well within the 4-year cooldown
    expect(w.lastAction.get(orgId)!.sinceTick).toBe(firstTick); // it did not act again
  });

  // 'two fresh worlds with the same seed execute identically' lives in
  // sim.determinism.orgs.test.ts — the fast suite excludes double 60-year runs.

  it('round-trips operational state + last action through save/load', () => {
    const w = createWorld(8);
    runYears(w, 1);
    const loaded = roundTrip(w);
    expect(hashWorld(loaded)).toBe(hashWorld(w)); // operational + action digest in the hash
    for (const org of w.organizations) {
      expect(loaded.operationalState.get(org.id)).toEqual(w.operationalState.get(org.id));
      expect(loaded.lastAction.get(org.id)).toEqual(w.lastAction.get(org.id));
    }
  });
});
