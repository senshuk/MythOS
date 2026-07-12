/**
 * Cultural ethics: same deed, different community → different standing damage.
 * Proves the perception–ethics pipeline end-to-end and that cultural weights
 * are deterministic (same seed ⇒ same culturally-scaled outcome).
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { witnessDeed } from './perception';
import { computeStanding } from './reputation';
import { fullActors, emit } from './world';
import { ethicsWeightFor, ethicsTaboos, CULTURES } from '../content/fixture';

// The culture roster is GENERATED per world-seed (content/cultureGen.ts) rather than a fixed
// 'martial'/'sylvan'/'devout' — so these tests no longer hardcode which id is tolerant or
// harsh. `createWorld(seed)` deterministically (re)generates that seed's roster as a side
// effect; find the most tolerant/harshest culture on a deed from whatever roster resulted.
function extremeIds(seed: number, deed: string): { tolerantId: string; harshId: string } {
  createWorld(seed);
  const sorted = [...CULTURES].sort((a, b) => ethicsWeightFor(a.id, deed) - ethicsWeightFor(b.id, deed));
  return { tolerantId: sorted[0].id, harshId: sorted[sorted.length - 1].id };
}

describe('ethicsWeightFor', () => {
  it('returns 1.0 for unknown deed kinds', () => {
    createWorld(1);
    expect(ethicsWeightFor(CULTURES[0].id, 'unknown_deed')).toBe(1.0);
  });

  it('the roster spans a real range of tolerance for bloodshed', () => {
    const { tolerantId, harshId } = extremeIds(1, 'bloodshed');
    expect(ethicsWeightFor(tolerantId, 'bloodshed')).toBeLessThan(ethicsWeightFor(harshId, 'bloodshed'));
  });
});

describe('ethicsTaboos', () => {
  it('the harshest culture on bloodshed carries at least one taboo', () => {
    const { harshId } = extremeIds(1, 'bloodshed');
    if (ethicsWeightFor(harshId, 'bloodshed') >= 1.5) {
      expect(ethicsTaboos(harshId).length).toBeGreaterThan(0);
      expect(ethicsTaboos(harshId)).toContain('shed blood');
    }
  });

  it('a culture tolerant of every existing deed kind reports no taboos', () => {
    const { tolerantId } = extremeIds(1, 'bloodshed');
    const allTolerant = ['bloodshed', 'violence', 'generosity'].every((d) => ethicsWeightFor(tolerantId, d) < 1.5);
    if (allTolerant) expect(ethicsTaboos(tolerantId)).toHaveLength(0);
  });
});

describe('perception: cultural ethics scale the standing cost', () => {
  it('killing costs more standing in the harshest-on-bloodshed settlement than the most tolerant', () => {
    const { tolerantId, harshId } = extremeIds(42, 'bloodshed');
    // Build two worlds from the same seed but force different settlement cultures
    // so the same deed produces culturally-weighted standing marks.
    const buildWith = (cultureId: string) => {
      const w = createWorld(42);
      w.settlements[w.focusedSettlementId].cultureId = cultureId;
      const actors = fullActors(w);
      const [culprit, victim] = actors;
      const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
      witnessDeed(w, eid, culprit, victim, 'bloodshed');
      return computeStanding(w.reputation.get(culprit)!, w.tick);
    };

    const tolerantStanding = buildWith(tolerantId);
    const harshStanding = buildWith(harshId);

    // both are negative, but the harsher culture kills you socially much harder
    expect(tolerantStanding).toBeLessThan(0);
    expect(harshStanding).toBeLessThan(0);
    expect(harshStanding).toBeLessThan(tolerantStanding);
  });

  it('tabooHorror thought appears in a witness from a culturally-outraged (weight ≥ 2) culture', () => {
    const { harshId } = extremeIds(42, 'bloodshed');
    if (ethicsWeightFor(harshId, 'bloodshed') < 2.0) return; // this seed's harshest doesn't reach outrage
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = harshId;
    const actors = fullActors(w);
    const [culprit, victim] = actors;
    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    const witnesses = witnessDeed(w, eid, culprit, victim, 'bloodshed');

    if (witnesses.length > 0) {
      const edge = w.rels.get(witnesses[0])?.get(culprit);
      const hadTabooHorror = edge?.thoughts.some((t) => t.kind === 'tabooHorror');
      expect(hadTabooHorror).toBe(true);
    }
  });

  it('a tolerant (weight < 2) culture produces feared, not tabooHorror, for bloodshed', () => {
    const { tolerantId } = extremeIds(42, 'bloodshed');
    if (ethicsWeightFor(tolerantId, 'bloodshed') >= 2.0) return; // this seed's most tolerant is still outraged
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = tolerantId;
    const actors = fullActors(w);
    const [culprit, victim] = actors;
    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    const witnesses = witnessDeed(w, eid, culprit, victim, 'bloodshed');

    if (witnesses.length > 0) {
      const edge = w.rels.get(witnesses[0])?.get(culprit);
      // may have some fear thought (bloodshed still has a witnessThought) but no tabooHorror
      const hadTabooHorror = edge?.thoughts.some((t) => t.kind === 'tabooHorror');
      expect(hadTabooHorror).toBeFalsy();
    }
  });

  it('is deterministic: same seed + same culture ⇒ same culturally-scaled standing', () => {
    const build = () => {
      const w = createWorld(7);
      const cultureId = CULTURES[0].id;
      w.settlements[w.focusedSettlementId].cultureId = cultureId;
      const [c, v] = fullActors(w);
      const eid = emit(w, 'died_brawl', [v, c], { age: 30 });
      witnessDeed(w, eid, c, v, 'bloodshed');
      return computeStanding(w.reputation.get(c)!, w.tick);
    };
    expect(build()).toBe(build());
  });
});
