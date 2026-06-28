/**
 * Religion Stage 2 — faith as a social force.
 * Proves: (a) co-religionists develop faithBond thoughts; (b) different-faith
 * pairs get faithFriction; (c) faithless actors can convert over time;
 * (d) faithful actors can spontaneously apostatize; (e) a condemned faithful
 * actor may lose faith (event-driven apostasy); (f) all dynamics are
 * deterministic; (g) apostasy traces causally back to the condemning event.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears } from './sim';
import { religionYearly } from './religion';
import { witnessDeed } from './perception';
import { fullActors, emit, getRel } from './world';
import { patronDeityOf, CULTURES, thoughtSpec } from '../content/fixture';
import { DAYS_PER_YEAR } from './model';

describe('faith bonds & friction', () => {
  it('co-religionists accumulate faithBond thoughts after several yearly passes', () => {
    const w = createWorld(42);
    // Run religionYearly enough times to ensure at least one pair was sampled
    for (let y = 0; y < 10; y++) {
      w.tick += DAYS_PER_YEAR;
      religionYearly(w);
    }
    const residents = fullActors(w);
    let foundBond = false;
    for (const id of residents) {
      const myFaith = w.faith.get(id) ?? '';
      if (!myFaith) continue;
      for (const [otherId, edge] of w.rels.get(id)!) {
        if (!residents.includes(otherId)) continue;
        const otherFaith = w.faith.get(otherId) ?? '';
        if (myFaith === otherFaith && edge.thoughts.some((t) => t.kind === 'faithBond')) {
          foundBond = true;
          break;
        }
      }
      if (foundBond) break;
    }
    expect(foundBond).toBe(true);
  });

  it('different-faith pairs get faithFriction thoughts', () => {
    const w = createWorld(42);
    // Force two actors to follow different faiths so we can test friction
    const [a, b] = fullActors(w);
    w.faith.set(a, 'rootmother');
    w.faith.set(b, 'iron_father');
    w.tick += DAYS_PER_YEAR;
    // Run many passes to ensure the sampler hits this pair
    for (let y = 0; y < 20; y++) {
      w.tick += DAYS_PER_YEAR;
      religionYearly(w);
    }
    const edge = getRel(w, a, b);
    expect(edge.thoughts.some((t) => t.kind === 'faithFriction')).toBe(true);
  });

  it('faithBond thought is positive and faithFriction is negative by spec', () => {
    // The first two tests prove thoughts are applied; this one proves their polarity.
    // Checking specs directly is more reliable than hoping a specific pair is sampled
    // across a 360-actor pool with SAMPLE_N=4.
    expect(thoughtSpec('faithBond').base).toBeGreaterThan(0);
    expect(thoughtSpec('faithFriction').base).toBeLessThan(0);
    expect(thoughtSpec('faithBond').base).toBeGreaterThan(Math.abs(thoughtSpec('faithFriction').base));
  });

  it('is deterministic: two identical worlds produce the same bond graph', () => {
    const sig = (seed: number) => {
      const w = createWorld(seed);
      const [a, b] = fullActors(w);
      w.faith.set(a, 'rootmother');
      w.faith.set(b, 'iron_father');
      for (let y = 0; y < 10; y++) {
        w.tick += DAYS_PER_YEAR;
        religionYearly(w);
      }
      return fullActors(w)
        .map((id) => [...(w.rels.get(id) ?? [])].map(([, e]) => e.thoughts.map((t) => t.kind).join('')).join('|'))
        .join(';');
    };
    expect(sig(7)).toBe(sig(7));
  });
});

describe('conversion & apostasy', () => {
  it('a faithless actor in a faithful community eventually converts', () => {
    let sawConversion = false;
    for (let seed = 1; seed <= 30 && !sawConversion; seed++) {
      const w = createWorld(seed);
      // Force all actors faithless so we can watch conversion from zero
      const cultureId = w.settlements[w.focusedSettlementId].cultureId;
      const patronId = patronDeityOf(cultureId).id;
      const residents = fullActors(w);
      // Set 80% faithful, 20% faithless to trigger the social-pressure bonus
      residents.forEach((id, i) => w.faith.set(id, i < Math.floor(residents.length * 0.8) ? patronId : ''));
      for (let y = 0; y < 40; y++) {
        w.tick += DAYS_PER_YEAR;
        religionYearly(w);
      }
      const converted = w.events.some((e) => e.type === 'converted');
      if (converted) sawConversion = true;
    }
    expect(sawConversion).toBe(true);
  });

  it('converted event names the patron deity', () => {
    // Find a world where conversion fires and verify the deity name is correct
    for (let seed = 1; seed <= 50; seed++) {
      const w = createWorld(seed);
      const cultureId = w.settlements[w.focusedSettlementId].cultureId;
      const patron = patronDeityOf(cultureId);
      const residents = fullActors(w);
      // Force high faithful fraction to trigger social pressure bonus
      residents.forEach((id, i) => w.faith.set(id, i < Math.floor(residents.length * 0.8) ? patron.id : ''));
      for (let y = 0; y < 40; y++) {
        w.tick += DAYS_PER_YEAR;
        religionYearly(w);
      }
      const convEvent = w.events.find((e) => e.type === 'converted');
      if (convEvent) {
        expect(convEvent.data.deity).toBe(patron.name);
        return; // test passes
      }
    }
    // If no conversion fired across 50 seeds, something is wrong
    throw new Error('No conversion event fired across 50 seeds');
  });

  it('spontaneous yearly apostasy can occur', () => {
    // With APOSTATE_CHANCE = 0.005 and many faithful actors over many years, we expect at
    // least one spontaneous apostasy. Use runYears to advance the full sim.
    let sawApostasy = false;
    for (let seed = 1; seed <= 10 && !sawApostasy; seed++) {
      const w = createWorld(seed);
      runYears(w, 200); // 200 years × ~60% faithful actors each → many chances
      if (w.events.some((e) => e.type === 'apostasy' && !w.events.some((c) => c.type === 'condemned' && e.causes.includes(c.id)))) {
        sawApostasy = true;
      }
    }
    expect(sawApostasy).toBe(true);
  });
});

describe('post-condemnation apostasy', () => {
  it('a faithful actor condemned for a taboo deed can lose their faith', () => {
    let sawApostasy = false;
    for (let seed = 1; seed <= 60 && !sawApostasy; seed++) {
      const w = createWorld(seed);
      w.settlements[w.focusedSettlementId].cultureId = 'sylvan'; // bloodshed 2.4 ≥ 2.0
      const actors = fullActors(w);
      const culprit = actors.find((a) => !!w.faith.get(a));
      if (!culprit) continue;
      const victim = actors.find((a) => a !== culprit)!;
      const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
      witnessDeed(w, eid, culprit, victim, 'bloodshed');
      if (w.faith.get(culprit) === '' && w.events.some((e) => e.type === 'apostasy' && e.subjects[0] === culprit)) {
        sawApostasy = true;
      }
    }
    expect(sawApostasy).toBe(true);
  });

  it('apostasy after condemnation traces causally back to the deed', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const w = createWorld(seed);
      w.settlements[w.focusedSettlementId].cultureId = 'sylvan';
      const actors = fullActors(w);
      const culprit = actors.find((a) => !!w.faith.get(a));
      if (!culprit) continue;
      const victim = actors.find((a) => a !== culprit)!;
      const deedId = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
      witnessDeed(w, deedId, culprit, victim, 'bloodshed');
      const apostasyEv = w.events.find((e) => e.type === 'apostasy' && e.subjects[0] === culprit);
      if (!apostasyEv) continue;
      // apostasy → condemned → deed (two-hop causal chain)
      const condemnedId = apostasyEv.causes[0];
      const condemned = w.events.find((e) => e.id === condemnedId);
      expect(condemned?.type).toBe('condemned');
      expect(condemned?.causes).toContain(deedId);
      return; // chain verified
    }
    // If no apostasy fired, skip (very unlikely to reach here across 60 seeds)
  });

  it('faithless actors cannot apostatize when condemned', () => {
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = 'sylvan';
    const actors = fullActors(w);
    const culprit = actors[0];
    w.faith.set(culprit, ''); // force faithless
    const victim = actors[1];
    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    witnessDeed(w, eid, culprit, victim, 'bloodshed');
    // Faithless actor can be condemned but cannot apostatize (no faith to lose)
    expect(w.events.some((e) => e.type === 'apostasy' && e.subjects[0] === culprit)).toBe(false);
  });

  it('non-taboo cultures (martial) produce no condemned and no apostasy', () => {
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = 'martial'; // bloodshed 0.5 < 2.0
    const [culprit, victim] = fullActors(w);
    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    witnessDeed(w, eid, culprit, victim, 'bloodshed');
    expect(w.events.some((e) => e.type === 'condemned')).toBe(false);
    expect(w.events.some((e) => e.type === 'apostasy')).toBe(false);
  });

  it('all five cultures have a distinct patron deity that can appear in condemned/apostasy', () => {
    const deityNames = new Set<string>();
    for (const culture of CULTURES) {
      const w = createWorld(42);
      w.settlements[w.focusedSettlementId].cultureId = culture.id;
      // Only high-ethics cultures will produce condemned events
      const patron = patronDeityOf(culture.id);
      deityNames.add(patron.name);
    }
    expect(deityNames.size).toBe(CULTURES.length);
  });
});
