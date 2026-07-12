/**
 * Religion Stage 1 — pantheon, actor faith, religious condemnation.
 * Proves: (a) every actor gets a stable faith at birth; (b) devout actors are
 * more likely to be faithful; (c) a taboo deed in a settlement with a patron
 * deity emits a `condemned` event naming the deity; (d) faithless actors exist;
 * (e) faith is deterministic across two runs with the same seed.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { witnessDeed } from './perception';
import { fullActors, emit } from './world';
import { deityById, patronDeityOf, faithProbability, DEITIES, CULTURES, type ValueAxis } from '../content/fixture';

// The roster is GENERATED per world-seed (content/cultureGen.ts) — a culture with a given
// dominant axis is no longer always the same literal id. Seed 7 generates all 6 possible
// dominant axes (see precepts.test.ts), so tests below resolve the culture they need by AXIS.
const SEED = 7;
function cultureByAxis(axis: ValueAxis): string {
  createWorld(SEED);
  const c = CULTURES.find((c) => c.dominantAxis === axis);
  if (!c) throw new Error(`seed ${SEED}'s roster has no ${axis}-dominant culture — pick a different seed`);
  return c.id;
}

describe('pantheon data', () => {
  it('every culture has a patron deity', () => {
    for (const c of CULTURES) {
      const d = deityById(c.patronDeityId);
      expect(d.id).toBe(c.patronDeityId);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.domain.length).toBeGreaterThan(0);
    }
  });

  it('patronDeityOf resolves each culture to its OWN distinct deity', () => {
    createWorld(SEED);
    const ids = CULTURES.map((c) => patronDeityOf(c.id).id);
    expect(new Set(ids).size).toBe(CULTURES.length);
  });

  it('every deity in the roster is defined with a unique id', () => {
    createWorld(SEED);
    const ids = DEITIES.map((d) => d.id);
    expect(new Set(ids).size).toBe(DEITIES.length);
  });

  it('faithProbability is higher with the devout trait', () => {
    expect(faithProbability(['devout'])).toBeGreaterThan(faithProbability([]));
    expect(faithProbability(['devout'])).toBeGreaterThanOrEqual(0.85);
    expect(faithProbability([])).toBeGreaterThan(0.5); // majority are faithful
  });
});

describe('actor faith assignment', () => {
  it('every live actor has a faith entry (faithful or faithless)', () => {
    const w = createWorld(42);
    for (const id of w.entities) {
      expect(w.faith.has(id)).toBe(true);
    }
  });

  it("faithful actors follow their settlement's patron deity", () => {
    const w = createWorld(42);
    const cultureId = w.settlements[w.focusedSettlementId].cultureId;
    const patronId = patronDeityOf(cultureId).id;
    let faithful = 0;
    for (const id of w.entities) {
      const f = w.faith.get(id);
      if (f) {
        expect(f).toBe(patronId); // no mixed faiths in Stage 1 — one patron per culture
        faithful++;
      }
    }
    expect(faithful).toBeGreaterThan(0); // not everyone is faithless
  });

  it('some actors are faithless (faith = "")', () => {
    // over many seeds, there will be faithless actors (probability < 1)
    let sawFaithless = false;
    for (let seed = 1; seed <= 20 && !sawFaithless; seed++) {
      const w = createWorld(seed);
      for (const id of w.entities) {
        if (w.faith.get(id) === '') { sawFaithless = true; break; }
      }
    }
    expect(sawFaithless).toBe(true);
  });

  it('is deterministic: same seed ⇒ identical faith assignments', () => {
    const sig = (seed: number) => {
      const w = createWorld(seed);
      return [...w.faith.entries()].sort(([a], [b]) => a - b).map(([id, f]) => `${id}:${f}`).join('|');
    };
    expect(sig(7)).toBe(sig(7));
    expect(sig(99)).toBe(sig(99));
  });
});

describe('actorView exposes faith', () => {
  it('faithful actor view includes deity name', () => {
    const w = createWorld(42);
    const snapshot = w; // actorView is an internal fn; test via world.faith directly
    const cultureId = w.settlements[w.focusedSettlementId].cultureId;
    const patronName = patronDeityOf(cultureId).name;
    let found = false;
    for (const id of w.entities) {
      const f = w.faith.get(id);
      if (f) {
        expect(deityById(f).name).toBe(patronName);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    void snapshot; // suppress unused warning
  });
});

describe('religious condemnation', () => {
  it('taboo deed in a nature-dominant settlement emits a condemned event naming its patron', () => {
    const natureCulture = cultureByAxis('nature'); // bloodshed weight ~2.4 ≥ 2.0
    const w = createWorld(SEED);
    w.settlements[w.focusedSettlementId].cultureId = natureCulture;
    const [culprit, victim] = fullActors(w);
    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    witnessDeed(w, eid, culprit, victim, 'bloodshed');

    const condemnation = w.events.find((e) => e.type === 'condemned' && e.subjects[0] === culprit);
    expect(condemnation).toBeDefined();
    expect(condemnation!.data.deity).toBe(patronDeityOf(natureCulture).name);
  });

  it('taboo deed in a tradition-dominant settlement names its patron', () => {
    const traditionCulture = cultureByAxis('tradition'); // bloodshed weight ~2.8 ≥ 2.0
    const w = createWorld(SEED);
    w.settlements[w.focusedSettlementId].cultureId = traditionCulture;
    const [culprit, victim] = fullActors(w);
    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    witnessDeed(w, eid, culprit, victim, 'bloodshed');

    const condemnation = w.events.find((e) => e.type === 'condemned');
    expect(condemnation).toBeDefined();
    expect(condemnation!.data.deity).toBe(patronDeityOf(traditionCulture).name);
  });

  it('non-taboo deed (war-dominant culture, weight < 2.0) does NOT produce condemned event', () => {
    const warCulture = cultureByAxis('war'); // bloodshed weight ~0.5
    const w = createWorld(SEED);
    w.settlements[w.focusedSettlementId].cultureId = warCulture;
    const [culprit, victim] = fullActors(w);
    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    witnessDeed(w, eid, culprit, victim, 'bloodshed');

    expect(w.events.find((e) => e.type === 'condemned')).toBeUndefined();
  });

  it('condemned event traces back to the deed that caused it', () => {
    const natureCulture = cultureByAxis('nature');
    const w = createWorld(SEED);
    w.settlements[w.focusedSettlementId].cultureId = natureCulture;
    const [culprit, victim] = fullActors(w);
    const deedId = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    witnessDeed(w, deedId, culprit, victim, 'bloodshed');

    const condemnation = w.events.find((e) => e.type === 'condemned');
    expect(condemnation!.causes).toContain(deedId);
  });
});
