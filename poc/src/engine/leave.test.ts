/**
 * LEAVING HOME (design/26 P5): a living player packs up their life and settles in
 * another town, riding the same emigration bookkeeping any adult uses — and the
 * gaze follows the life, exactly as it follows an heir at inheritance. Possession
 * is never dropped by a move (or by a gaze shifting elsewhere while possessed);
 * the world stops being one village deep. A rails operation, guarded against the
 * senseless (no player, the dead, one's own town, a ruin).
 */
import { describe, it, expect } from 'vitest';
import { createWorld, possess, leaveFor, focusSettlement } from './sim';
import { fullActors, getEvent, isAlive, summaryActors } from './world';
import { maturityOf } from './pack';
import { serializeWorld, deserializeWorld } from './persistence';

/** A world with the player possessing a young adult of the focused town, and a chosen
 *  DESTINATION: another living, un-ruined settlement to move the life to. */
function movableWorld(seed = 123456) {
  const w = createWorld(seed);
  const home = w.focusedSettlementId;
  const p = fullActors(w).find((id) => {
    const lc = w.lifecycle.get(id)!;
    const mat = maturityOf(w.identity.get(id)!.speciesId);
    return lc.alive && lc.ageYears >= mat + 2 && lc.ageYears <= mat + 20;
  })!;
  expect(p).toBeDefined();
  possess(w, p);
  const dest = w.settlements.find((s) => s.id !== home && s.ruinedYear === undefined && s.macro.population > 0)!;
  expect(dest).toBeDefined();
  return { w, p, home, destId: dest.id };
}

/** The player's most recent emigration event, if history still holds it. */
function lastEmigration(w: ReturnType<typeof createWorld>, p: number) {
  for (const eid of [...(w.eventsBySubject.get(p) ?? [])].reverse()) {
    const ev = getEvent(w, eid);
    if (ev?.type === 'emigrated' && ev.subjects[0] === p) return ev;
  }
  return undefined;
}

describe('leaving home', () => {
  it('rehomes the player to the destination and the gaze follows the life', () => {
    const { w, p, destId } = movableWorld();
    leaveFor(w, destId);

    expect(w.homeSettlement.get(p)).toBe(destId); // the life now lives there
    expect(w.focusedSettlementId).toBe(destId); // attention followed
    expect(w.fidelity.get(p)).toBe('full'); // promoted back to full in the new town
    expect(w.playerId).toBe(p); // possession never dropped by the move
  });

  it('records the departure as an emigration event naming both towns', () => {
    const { w, p, home, destId } = movableWorld();
    const fromName = w.settlements[home].name;
    const toName = w.settlements[destId].name;
    leaveFor(w, destId);
    const ev = lastEmigration(w, p);
    expect(ev).toBeDefined();
    expect(ev!.data).toMatchObject({ from: fromName, to: toName });
  });

  it('demotes the town left behind (its cast folds back to aggregate)', () => {
    const { w, home, destId } = movableWorld();
    expect(w.settlements[home].detailed).toBe(true);
    leaveFor(w, destId);
    expect(w.settlements[home].detailed).toBe(false);
  });

  it('is a no-op when the destination is the player\'s own home', () => {
    const { w, p, home } = movableWorld();
    const before = w.events.length;
    leaveFor(w, home);
    expect(w.homeSettlement.get(p)).toBe(home);
    expect(w.events.length).toBe(before); // nothing happened, nothing recorded
  });

  it('is a no-op toward a ruin (no one settles a dead town)', () => {
    const { w, p, home } = movableWorld();
    const ruin = w.settlements.find((s) => s.ruinedYear !== undefined);
    if (!ruin) return; // this seed has no ruin — nothing to assert
    leaveFor(w, ruin.id);
    expect(w.homeSettlement.get(p)).toBe(home); // stayed put
  });

  it('is a no-op when no one is possessed', () => {
    const w = createWorld(123456);
    const home = w.focusedSettlementId;
    const dest = w.settlements.find((s) => s.id !== home && s.ruinedYear === undefined && s.macro.population > 0)!;
    const before = w.focusedSettlementId;
    leaveFor(w, dest.id);
    expect(w.focusedSettlementId).toBe(before); // no player, no move
  });

  it('is a no-op when the possessed actor is dead', () => {
    const { w, p, home, destId } = movableWorld();
    w.lifecycle.get(p)!.alive = false; // the dead do not emigrate — they are succeeded
    leaveFor(w, destId);
    expect(w.homeSettlement.get(p)).toBe(home);
    expect(w.focusedSettlementId).toBe(home);
  });

  it('survives a save round-trip — the moved life is still possessed and homed', () => {
    const { w, p, destId } = movableWorld();
    leaveFor(w, destId);
    const restored = deserializeWorld(serializeWorld(w));
    expect(restored.playerId).toBe(p);
    expect(restored.homeSettlement.get(p)).toBe(destId);
    expect(restored.focusedSettlementId).toBe(destId);
  });
});

describe('a possessed actor is never freed by a shifting gaze', () => {
  it('keeps the player as a summary survivor when attention moves elsewhere', () => {
    const { w, p, destId } = movableWorld();
    // turn the gaze away WITHOUT moving the player's life (plain focus shift)
    focusSettlement(w, destId);
    expect(w.identity.has(p)).toBe(true); // not removed by demotion
    expect(w.fidelity.get(p)).toBe('summary'); // folded to a summary soul, not erased
    expect(isAlive(w, p)).toBe(true);
    expect(w.playerId).toBe(p); // possession intact across the shift
  });

  it('follows and promotes a summary actor when possessing them from afar', () => {
    const w = createWorld(123456);
    const firstHome = w.focusedSettlementId;
    const dest = w.settlements.find((s) => s.id !== firstHome && s.ruinedYear === undefined && s.macro.population > 0)!;
    focusSettlement(w, dest.id);
    const p = summaryActors(w).find((id) => w.homeSettlement.get(id) === firstHome)!;
    expect(p).toBeDefined();

    possess(w, p);

    expect(w.playerId).toBe(p);
    expect(w.focusedSettlementId).toBe(firstHome);
    expect(w.fidelity.get(p)).toBe('full');
    expect(fullActors(w)).toContain(p);
  });
});
