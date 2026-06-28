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
import { ethicsWeightFor, ethicsTaboos } from '../content/fixture';

describe('ethicsWeightFor', () => {
  it('returns 1.0 for unknown deed kinds', () => {
    expect(ethicsWeightFor('martial', 'unknown_deed')).toBe(1.0);
  });

  it('martial culture tolerates bloodshed (< 1)', () => {
    expect(ethicsWeightFor('martial', 'bloodshed')).toBeLessThan(1.0);
  });

  it('sylvan culture abhors bloodshed (≥ 2)', () => {
    expect(ethicsWeightFor('sylvan', 'bloodshed')).toBeGreaterThanOrEqual(2.0);
  });

  it('devout culture abhors bloodshed most (highest weight)', () => {
    const devout = ethicsWeightFor('devout', 'bloodshed');
    const sylvan = ethicsWeightFor('sylvan', 'bloodshed');
    const martial = ethicsWeightFor('martial', 'bloodshed');
    expect(devout).toBeGreaterThan(sylvan);
    expect(sylvan).toBeGreaterThan(martial);
  });
});

describe('ethicsTaboos', () => {
  it('returns deed labels for high-weight cultures', () => {
    const sylvanTaboos = ethicsTaboos('sylvan');
    expect(sylvanTaboos.length).toBeGreaterThan(0);
    // bloodshed (weight 2.4) and violence (1.8) are both ≥ 1.5
    expect(sylvanTaboos).toContain('shed blood');
    expect(sylvanTaboos).toContain('came to blows');
  });

  it('returns empty for cultures that tolerate all existing deed kinds', () => {
    // martial: bloodshed 0.5, violence 0.35, generosity 0.9 — all < 1.5
    expect(ethicsTaboos('martial')).toHaveLength(0);
  });
});

describe('perception: cultural ethics scale the standing cost', () => {
  it('killing costs more standing in a pacifist settlement than in a martial one', () => {
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

    const martialStanding = buildWith('martial'); // weight 0.5 → standing dented less
    const sylvanStanding = buildWith('sylvan'); // weight 2.4 → standing dented more

    // both are negative, but sylvan kills you socially much harder
    expect(martialStanding).toBeLessThan(0);
    expect(sylvanStanding).toBeLessThan(0);
    expect(sylvanStanding).toBeLessThan(martialStanding);
  });

  it('tabooHorror thought appears in a culturally-outraged witness', () => {
    // sylvan culture: bloodshed weight 2.4 ≥ 2.0 → tabooHorror
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = 'sylvan';
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

  it('martial culture produces feared (not tabooHorror) for bloodshed', () => {
    // martial: weight 0.5 < 2.0 → feared (original thought kind), not tabooHorror
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = 'martial';
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
      w.settlements[w.focusedSettlementId].cultureId = 'devout';
      const [c, v] = fullActors(w);
      const eid = emit(w, 'died_brawl', [v, c], { age: 30 });
      witnessDeed(w, eid, c, v, 'bloodshed');
      return computeStanding(w.reputation.get(c)!, w.tick);
    };
    expect(build()).toBe(build());
  });
});
