/**
 * Coronation → allegiance, rung 1: an organization recognizes a ruler by DERIVED belief.
 *
 * The first *institutional* consumer of belief. orgStatusBeliefOf reduces the seat members'
 * status beliefs to the polity's recognized ruler — never stored, the collective twin of
 * computeStatusBelief. Allegiance runs on what the institution's people believe, so it can
 * revise, lag reality, and (once news travels) diverge between polities. No live wiring yet.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, focusSettlement } from './sim';
import { fullActors } from './world';
import { getOrganization } from './organization';
import { learnCoronation } from './statusBelief';
import { orgStatusBeliefOf } from './orgReason';

const SLOT = 'monarch-of-realm';

function firstGoverned(w: ReturnType<typeof createWorld>) {
  for (const s of w.settlements) if (s.polityId !== undefined && s.ruinedYear === undefined) return s;
  return undefined;
}

describe('organizations recognize a ruler by derived belief (institutional allegiance)', () => {
  it('a polity recognizes the ruler its members broadly believe reigns, and revises when they learn of a new one', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id); // instantiate resident members
    const org = getOrganization(w, seat.polityId!)!;
    const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);
    const [aldric, beatrice] = residents;

    // no one has heard of any coronation → the institution recognizes no one
    expect(orgStatusBeliefOf(w, org.id, SLOT).occupant).toBeUndefined();

    // the realm's people learn Aldric was crowned → the institution recognizes Aldric
    for (const r of residents) learnCoronation(w, r, aldric, SLOT, 0);
    expect(orgStatusBeliefOf(w, org.id, SLOT).occupant).toBe(aldric);

    // they learn of Beatrice's coronation → the institution's allegiance revises
    for (const r of residents) learnCoronation(w, r, beatrice, SLOT, 0);
    expect(orgStatusBeliefOf(w, org.id, SLOT).occupant).toBe(beatrice);
  });

  it('the institution recognizes the more-believed claimant (collective resolution by weight of belief)', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const org = getOrganization(w, seat.polityId!)!;
    const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);
    const [aldric, beatrice] = residents;

    // a majority hears Aldric, a minority hears Beatrice → the polity recognizes Aldric
    const cut = Math.floor(residents.length * 0.7);
    residents.slice(0, cut).forEach((r) => learnCoronation(w, r, aldric, SLOT, 0));
    residents.slice(cut).forEach((r) => learnCoronation(w, r, beatrice, SLOT, 0));
    expect(orgStatusBeliefOf(w, org.id, SLOT).occupant).toBe(aldric);
  });

  it('a polity with no simulated members recognizes no one (subjectivity needs subjects)', () => {
    const w = createWorld(5);
    const aggregate = w.organizations.find(
      (o) => o.dissolvedYear === undefined && o.seatId !== undefined && o.seatId !== w.focusedSettlementId,
    );
    if (aggregate) {
      expect(orgStatusBeliefOf(w, aggregate.id, SLOT).occupant).toBeUndefined();
    }
  });

  it('is deterministic', () => {
    const run = () => {
      const w = createWorld(5);
      const seat = firstGoverned(w)!;
      focusSettlement(w, seat.id);
      const org = getOrganization(w, seat.polityId!)!;
      const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);
      residents.forEach((r) => learnCoronation(w, r, residents[0], SLOT, 0));
      return orgStatusBeliefOf(w, org.id, SLOT);
    };
    expect(run()).toEqual(run());
  });
});
