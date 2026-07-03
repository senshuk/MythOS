/**
 * Organizations derive belief — they never own it (Subjectivity + LOD).
 *
 * The law: subjectivity exists only where agency exists. An Actor holds beliefs; an
 * Organization DERIVES them from its members (like worldviewOf derives worldview from member
 * values); an aggregate settlement holds none. orgBeliefOf reads member beliefs and stores
 * nothing — no second epistemic source of truth on the org.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, focusSettlement } from './sim';
import { fullActors, emit } from './world';
import { getOrganization } from './organization';
import { witnessBelief } from './belief';
import { orgBeliefOf } from './orgReason';

/** First settlement (by id) that hosts a polity. */
function firstGoverned(w: ReturnType<typeof createWorld>) {
  for (const s of w.settlements) if (s.polityId !== undefined && s.ruinedYear === undefined) return s;
  return undefined;
}

describe('organizations derive belief from members (never own an evidence stack)', () => {
  it('an org comes to believe a death once its members broadly do', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id); // instantiate residents so the org has member subjects
    const org = getOrganization(w, seat.polityId!)!;
    const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);
    const dead = residents[0];

    // no member knows → the institution has no belief
    expect(orgBeliefOf(w, org.id, dead, 'dead').stance).toBe('unknown');

    // every resident learns of the death → the institution now knows it too
    const deathId = emit(w, 'died', [dead], {});
    for (const r of residents) if (r !== dead) witnessBelief(w, r, dead, 'dead', deathId);
    expect(orgBeliefOf(w, org.id, dead, 'dead').stance).toBe('true');
  });

  it('one member knowing is not the institution knowing (broad awareness, not gossip)', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const org = getOrganization(w, seat.polityId!)!;
    const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);
    const dead = residents[0];

    const deathId = emit(w, 'died', [dead], {});
    witnessBelief(w, residents[1], dead, 'dead', deathId); // exactly one member learns
    expect(orgBeliefOf(w, org.id, dead, 'dead').stance).toBe('unknown');
  });

  it('institutional confidence RISES monotonically as more members learn', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const org = getOrganization(w, seat.polityId!)!;
    const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);
    const dead = residents[0];
    const knowers = residents.filter((r) => r !== dead);
    const deathId = emit(w, 'died', [dead], {});

    const c0 = orgBeliefOf(w, org.id, dead, 'dead').confidence;
    knowers.slice(0, Math.floor(knowers.length / 2)).forEach((r) => witnessBelief(w, r, dead, 'dead', deathId));
    const c1 = orgBeliefOf(w, org.id, dead, 'dead').confidence;
    knowers.forEach((r) => witnessBelief(w, r, dead, 'dead', deathId));
    const c2 = orgBeliefOf(w, org.id, dead, 'dead').confidence;

    expect(c1).toBeGreaterThan(c0);
    expect(c2).toBeGreaterThan(c1);
  });

  it('the org owns no evidence: belief is derived, not stored', () => {
    const w = createWorld(5);
    const org = getOrganization(w, firstGoverned(w)!.polityId!)!;
    // no evidence stack on the record, and no per-org belief store on the world
    expect(Object.keys(org)).not.toContain('beliefs');
    expect(Object.keys(org)).not.toContain('evidence');
    expect(Object.keys(w)).not.toContain('orgBeliefs');
  });

  it('an org with no simulated members holds no belief (subjectivity needs subjects)', () => {
    const w = createWorld(5);
    // an org whose seat is NOT the focused settlement has only aggregate residents — no subjects
    const aggregate = w.organizations.find(
      (o) => o.dissolvedYear === undefined && o.seatId !== undefined && o.seatId !== w.focusedSettlementId,
    );
    if (aggregate) {
      expect(orgBeliefOf(w, aggregate.id, fullActors(w)[0], 'dead').stance).toBe('unknown');
    }
  });
});
