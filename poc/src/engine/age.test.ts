/**
 * AGE — proving the one thing design/30 §4.6 requires: an epoch-transition rewrites
 * world.rules live, and once it does, an Intent the Resolver used to accept becomes
 * ILLEGAL, not merely less likely. Uses pressClaim (the one Rules-gated Intent this
 * slice wires up) as the end-to-end proof.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears } from './sim';
import { transitionAge } from './age';
import { rankClaimants, pressClaim, getFigure, mintFigure } from './figures';
import { governmentById } from './pack';
import { canSeekRule } from './social';
import { Rng } from './rng';
import { DAYS_PER_YEAR, type World, type Settlement } from './model';

const yearOf = (world: World) => Math.floor(world.tick / DAYS_PER_YEAR);

/** Same setup as claim.test.ts: a leader-bearing seat with a sitting incumbent and a
 *  ripe (failing) ruler, so pressClaim would succeed absent a Rules gate. */
function ripeSeat(world: World): { s: Settlement; front: number } {
  const s = world.settlements[world.focusedSettlementId];
  if (governmentById(s.governmentId).succession === 'none') {
    const g = world.settlements.map((x) => x.governmentId).find((gid) => governmentById(gid).succession !== 'none');
    if (g !== undefined) s.governmentId = g;
  }
  if (getFigure(world, s.currentRulerId) === undefined) {
    const ruler = mintFigure(world, s, yearOf(world), new Rng(5), 'ruler');
    s.currentRulerId = ruler.id;
  }
  getFigure(world, s.currentRulerId)!.reignEnd = yearOf(world); // ripe: the ruler is failing now
  return { s, front: rankClaimants(world, s.id)[0].id };
}

describe('transitionAge', () => {
  it('rewrites world.rules and emits a legible age_transition event', () => {
    const world = createWorld(7, true);
    runYears(world, 25);
    expect(world.rules.succession.claimsEnabled).toBe(true); // the pack default

    const evBefore = world.events.length;
    transitionAge(world, 'the Age of Claimants has ended', { succession: { claimsEnabled: false } });

    expect(world.rules.succession.claimsEnabled).toBe(false);
    const ev = world.events.slice(evBefore).find((e) => e.type === 'age_transition');
    expect(ev).toBeDefined();
    expect(ev!.data.name).toBe('the Age of Claimants has ended');
    expect(ev!.data.claimsEnabled).toBe('false');
  });

  it('makes a previously-legal pressClaim illegal — the Resolver rejects before attempt', () => {
    const world = createWorld(7, true);
    runYears(world, 25);
    const { s, front } = ripeSeat(world);
    const before = s.currentRulerId;

    transitionAge(world, 'the Age of Claimants has ended', { succession: { claimsEnabled: false } });
    const evBefore = world.events.length;
    pressClaim(world, front, new Rng(999)); // would have seated `front` before the transition

    expect(s.currentRulerId).toBe(before); // rejected — no seat change
    expect(world.events.slice(evBefore).some((e) => e.type === 'claim_pressed')).toBe(false); // no attempt recorded
  });

  it('withdraws the seat-seeking offer itself, so the ambition never lies about what pressClaim allows', () => {
    const world = createWorld(7, true);
    runYears(world, 25);
    const { front } = ripeSeat(world);
    expect(canSeekRule(world, front)).toBe(true);

    transitionAge(world, 'the Age of Claimants has ended', { succession: { claimsEnabled: false } });
    expect(canSeekRule(world, front)).toBe(false);
  });

  it('a later Age can re-legalize claims — Rules are data, not a one-way ratchet', () => {
    const world = createWorld(7, true);
    runYears(world, 25);
    transitionAge(world, 'the Age of Claimants has ended', { succession: { claimsEnabled: false } });
    transitionAge(world, 'the Restoration', { succession: { claimsEnabled: true } });
    expect(world.rules.succession.claimsEnabled).toBe(true);
  });
});
