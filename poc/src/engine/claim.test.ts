/**
 * The first player LEVER on the grand systems: a proactive, peaceful bid for a seat. rankClaimants
 * exposes the succession race chooseHeir decides by; pressClaim lets the acclaimed front-runner take
 * the seat early when the sitting ruler is failing. One rule set — the same verb an NPC would use.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorld, runYears } from './sim';
import { rankClaimants, chooseHeir, pressClaim, getFigure, mintFigure, CLAIM_RIPE_WINDOW } from './figures';
import { governmentById } from './pack';
import { AMBITIONS } from '../content/ambitions';
import { isRuler } from './social';
import { Rng } from './rng';
import { DAYS_PER_YEAR, type World, type Settlement } from './model';

let w: World;
let sid: number;
beforeAll(() => {
  w = createWorld(7, true);
  runYears(w, 25); // a focused town with simulated residents and a sitting ruler
  sid = w.focusedSettlementId;
});

const yearOf = (world: World) => Math.floor(world.tick / DAYS_PER_YEAR);

/**
 * Give the focused settlement a leader-bearing seat with a sitting incumbent, so the claim mechanic
 * has something to act on. (Some worlds focus a leaderless polity — the claim simply doesn't apply
 * there; this setup lets us test the mechanic itself, not worldgen's government roll.) Returns the
 * settlement and the current front-runner among its simulated residents.
 */
function seatWithRuler(world: World): { s: Settlement; front: number } {
  const s = world.settlements[world.focusedSettlementId];
  if (governmentById(s.governmentId).succession === 'none') {
    const g = world.settlements.map((x) => x.governmentId).find((gid) => governmentById(gid).succession !== 'none');
    if (g !== undefined) s.governmentId = g;
  }
  if (getFigure(world, s.currentRulerId) === undefined) {
    const ruler = mintFigure(world, s, yearOf(world), new Rng(5), 'ruler'); // a minted incumbent to unseat
    s.currentRulerId = ruler.id;
  }
  return { s, front: rankClaimants(world, s.id)[0].id };
}

describe('rankClaimants — the succession race made legible', () => {
  it('ranks the same claimants deterministically, front-runner === chooseHeir', () => {
    const ranked = rankClaimants(w, sid);
    expect(ranked.length).toBeGreaterThan(0);
    // a total order: prominence desc, ties desc, id asc
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1], b = ranked[i];
      const ordered = a.prominence > b.prominence
        || (a.prominence === b.prominence && a.ties > b.ties)
        || (a.prominence === b.prominence && a.ties === b.ties && a.id < b.id);
      expect(ordered).toBe(true);
    }
    expect(rankClaimants(w, sid)).toEqual(ranked); // pure read
    expect(chooseHeir(w, sid)).toBe(ranked[0].id); // the decider picks the front-runner
  });
});

describe('pressClaim — a peaceful bid for the seat', () => {
  it('seats the front-runner when the ruler is failing, and the ascension cites the claim', () => {
    const world = createWorld(7, true);
    runYears(world, 25);
    const { s, front } = seatWithRuler(world);
    expect(s.currentRulerId).not.toBe(front); // the incumbent still holds the seat
    getFigure(world, s.currentRulerId)!.reignEnd = yearOf(world); // the ruler is failing now

    const evBefore = world.events.length;
    pressClaim(world, front, new Rng(999));

    expect(s.currentRulerId).toBe(front); // the town raised them
    expect(isRuler(world, front)).toBe(true);
    // a claim_pressed event was recorded, and the seating (ascension/dynasty) cites it as its cause
    const claimEv = world.events.slice(evBefore).find((e) => e.type === 'claim_pressed');
    expect(claimEv).toBeDefined();
    const seating = world.events.slice(evBefore).find((e) => (e.type === 'ascension' || e.type === 'dynasty') && e.subjects.includes(front));
    expect(seating?.causes).toContain(claimEv!.id);
  });

  it('does nothing when the claimant is not the front-runner', () => {
    const world = createWorld(7, true);
    runYears(world, 25);
    const { s } = seatWithRuler(world);
    const ranked = rankClaimants(world, s.id);
    if (ranked.length < 2) return; // need a runner-up to test
    getFigure(world, s.currentRulerId)!.reignEnd = yearOf(world); // ripe, but…
    const before = s.currentRulerId;
    pressClaim(world, ranked[1].id, new Rng(1)); // …a mere runner-up presses
    expect(s.currentRulerId).toBe(before); // rebuffed — the seat does not change hands
  });

  it('does nothing when the moment is not yet ripe (ruler holds firm)', () => {
    const world = createWorld(7, true);
    runYears(world, 25);
    const { s, front } = seatWithRuler(world);
    getFigure(world, s.currentRulerId)!.reignEnd = yearOf(world) + CLAIM_RIPE_WINDOW + 20; // firmly seated
    const before = s.currentRulerId;
    pressClaim(world, front, new Rng(1));
    expect(s.currentRulerId).toBe(before); // premature — nothing happens
  });
});

describe("the 'rise' ambition — the race, surfaced to the player", () => {
  const rise = AMBITIONS.find((a) => a.id === 'rise')!;

  it('names where you stand, and offers the claim ONLY when the moment is ripe', () => {
    const world = createWorld(7, true);
    runYears(world, 25);
    const { s, front } = seatWithRuler(world);
    const ruler = getFigure(world, s.currentRulerId)!;

    // firmly seated → the note names the standing, and the claim is NOT offered
    ruler.reignEnd = yearOf(world) + 40;
    expect(rise.note!(world, front, undefined).length).toBeGreaterThan(0);
    expect(rise.nextStep!(world, front, undefined)!.options.some((o) => o.intent.kind === 'press_claim')).toBe(false);

    // failing → the claim IS offered to the front-runner
    ruler.reignEnd = yearOf(world);
    expect(rise.nextStep!(world, front, undefined)!.options.some((o) => o.intent.kind === 'press_claim')).toBe(true);

    // a runner-up is told their place in the race and is never offered the claim
    const ranked = rankClaimants(world, s.id);
    if (ranked.length >= 2) {
      expect(rise.note!(world, ranked[1].id, undefined)).toMatch(/to inherit/);
      expect(rise.nextStep!(world, ranked[1].id, undefined)!.options.some((o) => o.intent.kind === 'press_claim')).toBe(false);
    }
  });
});
