/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, focusSettlement } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { personalityOf } from './social';
import { createActor } from './world';
import { renderEvent } from './render';
import { addThought, computeOpinion, opinionReasons } from './opinion';
import { Rng } from './rng';
import { VALUES, CULTURES, culturalDistance, mostOpposedValue, THOUGHT_SPECS, valueProfile, valueAlignment, natureOf, TEMPERAMENTS, temperamentProfile, temperamentAffinity, TRAITS, TRAIT_SPECTRA, pickTraits, unionViable, canBear } from '../content/fixture';
import { DAYS_PER_YEAR, type RelEdge } from './model';

describe('opinion (thoughts)', () => {
  const newEdge = (): RelEdge => ({ thoughts: [], sinceTick: 0, flags: {} });

  it('is thought-AGNOSTIC: a pack can define a thought kind the engine never declared', () => {
    THOUGHT_SPECS['debtOfHonour'] = { base: 200, stackLimit: 1, mult: 1, label: 'owed a debt' };
    try {
      const edge = newEdge();
      addThought(edge, 'debtOfHonour', 0); // a kind unknown to the engine
      expect(computeOpinion(edge, 0)).toBe(200); // its pack value flows through
      expect(opinionReasons(edge, 0)[0].label).toBe('owed a debt'); // …and its pack label
    } finally {
      delete THOUGHT_SPECS['debtOfHonour'];
    }
  });

  it('opinion is the diminishing-returns sum of thoughts (saturates, not linear)', () => {
    const edge = newEdge();
    for (let i = 0; i < 6; i++) addThought(edge, 'bonded', 0);
    const op = computeOpinion(edge, 0);
    expect(op).toBeGreaterThan(30); // more than a single thought
    expect(op).toBeLessThan(6 * 30); // but less than the naive sum — diminishing returns
  });

  it('memory thoughts expire; permanent ones (marriage) do not', () => {
    const a = newEdge();
    addThought(a, 'kindness', 0); // has a finite duration
    expect(computeOpinion(a, 0)).toBeGreaterThan(0);
    expect(computeOpinion(a, 100 * DAYS_PER_YEAR)).toBe(0); // faded away

    const b = newEdge();
    addThought(b, 'wed', 0); // permanent
    expect(computeOpinion(b, 100 * DAYS_PER_YEAR)).toBeGreaterThan(500);
  });

  it('a thought kind is bounded by its stack limit', () => {
    const edge = newEdge();
    for (let i = 0; i < 60; i++) addThought(edge, 'bonded', i); // distinct ticks, all active
    const bonded = edge.thoughts.filter((t) => t.kind === 'bonded');
    expect(bonded.length).toBeLessThanOrEqual(25);
  });

  it('opinion is legible: reasons list the thoughts behind it', () => {
    const edge = newEdge();
    addThought(edge, 'bonded', 0);
    addThought(edge, 'kindness', 0);
    addThought(edge, 'slighted', 0);
    const reasons = opinionReasons(edge, 0);
    expect(reasons.length).toBeGreaterThanOrEqual(2);
    expect(reasons.some((r) => r.value > 0)).toBe(true);
    expect(reasons.some((r) => r.value < 0)).toBe(true);
    expect(reasons.every((r) => typeof r.label === 'string' && r.label.length > 0)).toBe(true);
  });
});

describe('culture/values drive relations (wars have reasons, not dice)', () => {
  it('the pack defines value axes, cultures, distance, and the opposed-value reason', () => {
    expect(VALUES.length).toBeGreaterThan(0);
    expect(CULTURES.length).toBeGreaterThan(1);
    expect(culturalDistance('martial', 'martial')).toBe(0); // identical = no distance
    // the war-creed is further from the green way than from a kindred martial faith
    expect(culturalDistance('martial', 'sylvan')).toBeGreaterThan(culturalDistance('martial', 'devout'));
    // and what they most disagree on is war or nature
    expect(['war', 'nature']).toContain(mostOpposedValue('martial', 'sylvan'));
  });

  it('culturally-opposed settlements grow hostile while aligned ones grow friendly', () => {
    let alignedSum = 0, alignedN = 0, opposedSum = 0, opposedN = 0;
    for (let seed = 1; seed < 16; seed++) {
      const w = createWorld(seed, false);
      runYears(w, 150);
      for (const e of w.edges) {
        const d = culturalDistance(w.settlements[e.a].cultureId, w.settlements[e.b].cultureId);
        if (d < 12) { alignedSum += e.relation; alignedN++; } else if (d > 28) { opposedSum += e.relation; opposedN++; }
      }
    }
    // averaged across many edges/seeds, aligned peoples are markedly friendlier
    expect(alignedSum / Math.max(1, alignedN)).toBeGreaterThan(opposedSum / Math.max(1, opposedN) + 15);
  });

  it('a conflict records its cultural cause, and the prose names it', () => {
    let sawReason = false;
    for (let seed = 1; seed < 20 && !sawReason; seed++) {
      const w = createWorld(seed, false);
      runYears(w, 300);
      const conflict = w.events.find(
        (e) => (e.type === 'raid' || e.type === 'battle' || e.type === 'conquest') && typeof e.data.reason === 'string',
      );
      if (conflict) {
        sawReason = true;
        expect(VALUES).toContain(conflict.data.reason as string); // the opposed value axis
        expect(renderEvent(w, conflict)).toContain('over '); // the cultural clause is rendered
      }
    }
    expect(sawReason).toBe(true);
  });
});

describe('every actor has a PERSONALITY (values + temperament, not a culture clone)', () => {
  it('a value profile is deterministic, bounded, and shaped by culture + traits + deviation', () => {
    const a = valueProfile('martial', ['proud', 'bold'], new Rng(12345));
    const b = valueProfile('martial', ['proud', 'bold'], new Rng(12345)); // same seed ⇒ identical
    expect(a).toEqual(b);
    for (const axis of VALUES) expect(Math.abs(a[axis])).toBeLessThanOrEqual(100);
    // the 'gentle' soul of a war-creed leans far less warlike than a 'cruel' one
    const gentle = valueProfile('martial', ['gentle'], new Rng(7));
    const cruel = valueProfile('martial', ['cruel'], new Rng(7)); // same deviation, traits differ
    expect(gentle.war).toBeLessThan(cruel.war);
  });

  it('TEMPERAMENT is a SECOND, individual dimension — owes nothing to culture', () => {
    // same culture, same seed, but the temperament generator never reads culture at all,
    // so two people of one creed with different traits diverge in disposition.
    const t1 = temperamentProfile(['volcanic', 'gregarious'], new Rng(8));
    const t2 = temperamentProfile(['serene', 'shy'], new Rng(8)); // same deviation, opposite traits
    expect(t1.temper).toBeGreaterThan(t2.temper); // hot-blooded vs serene
    expect(t1.sociability).toBeGreaterThan(t2.sociability); // gregarious vs solitary
    for (const axis of TEMPERAMENTS) expect(Math.abs(t1[axis])).toBeLessThanOrEqual(100);
    // deterministic
    expect(temperamentProfile(['bold'], new Rng(3))).toEqual(temperamentProfile(['bold'], new Rng(3)));
  });

  it('traits are SPECTRA — an actor never holds two from one family (no kind AND cruel)', () => {
    const spectrumOf = (id: string) => TRAITS.find((t) => t.id === id)!.spectrum;
    for (let seed = 1; seed < 200; seed++) {
      const traits = pickTraits(new Rng(seed));
      const families = traits.map(spectrumOf);
      expect(new Set(families).size).toBe(families.length); // all distinct spectra
      expect(traits.length).toBeGreaterThanOrEqual(1);
    }
    expect(TRAIT_SPECTRA.length).toBeGreaterThan(5); // a rich set of facets
  });

  it('two souls of the SAME people still differ — individuals, not clones', () => {
    const w = createWorld(1);
    focusSettlement(w, 0);
    runYears(w, 5);
    const same = w.entities.filter((id) => {
      const h = w.homeSettlement.get(id);
      return h === 0 && w.lifecycle.get(id)?.alive;
    });
    expect(same.length).toBeGreaterThan(3);
    const profiles = same.map((id) => JSON.stringify(personalityOf(w, id)));
    expect(new Set(profiles).size).toBeGreaterThan(1); // not one shared culture profile
    // and a personality is INNATE — fixed at birth and saved, so it survives a load intact
    const before = personalityOf(w, same[0]);
    const reloaded = deserializeWorld(serializeWorld(w));
    expect(reloaded.personality.size).toBeGreaterThan(0); // carried in the save
    expect(personalityOf(reloaded, same[0])).toEqual(before);
  });

  it('kindred values raise social affinity; opposed values lower it (bonds have reasons)', () => {
    const a = valueProfile('martial', ['bold', 'proud'], new Rng(3));
    const kin = valueProfile('martial', ['bold', 'stoic'], new Rng(4)); // like-minded warriors
    const foe = valueProfile('sylvan', ['gentle', 'restless'], new Rng(5)); // opposite worldview
    expect(valueAlignment(a, kin)).toBeGreaterThan(valueAlignment(a, foe));
  });

  it('warm dispositions raise affinity; two volatile tempers grate (chemistry, not just values)', () => {
    const warmA = temperamentProfile(['gregarious', 'kind'], new Rng(11));
    const warmB = temperamentProfile(['gregarious', 'gentle'], new Rng(12));
    const hotA = temperamentProfile(['volcanic'], new Rng(13));
    const hotB = temperamentProfile(['volcanic'], new Rng(14));
    expect(temperamentAffinity(warmA, warmB)).toBeGreaterThan(temperamentAffinity(hotA, hotB));
  });

  it('natureOf reads disposition AND values into a legible sketch', () => {
    const p = {
      values: valueProfile('martial', ['cruel', 'proud'], new Rng(9)),
      temperament: temperamentProfile(['volcanic', 'shy'], new Rng(9)),
    };
    const sketch = natureOf(p);
    expect(typeof sketch).toBe('string');
    expect(sketch.length).toBeGreaterThan(0);
    // a volcanic, solitary soul should read as hot-blooded and/or solitary
    expect(/hot-blooded|solitary|warlike|honourable|dishonourable|timid|bold/.test(sketch)).toBe(true);
  });

  it('some souls DEVIATE from their own people — outsiders arise', () => {
    // the deviation that flips a soul against its own creed is rare per-person, so scan several
    // towns: at least one should hold an actor who opposes their culture on a strong value axis.
    let sawOutsider = false;
    for (let seed = 2; seed < 14 && !sawOutsider; seed++) {
      const w = createWorld(seed);
      focusSettlement(w, 0);
      runYears(w, 12);
      const cultureVals = CULTURES.find((c) => c.id === w.settlements[0].cultureId)!.values;
      for (const id of w.entities) {
        if (w.homeSettlement.get(id) !== 0 || !w.lifecycle.get(id)?.alive) continue;
        const v = personalityOf(w, id).values;
        for (const axis of VALUES) {
          const cv = cultureVals[axis] ?? 0;
          if (Math.sign(v[axis]) !== Math.sign(cv) && Math.abs(v[axis]) > 20 && Math.abs(cv) > 20) sawOutsider = true;
        }
      }
    }
    expect(sawOutsider).toBe(true);
  });
});

describe('reproduction is species DATA (not a hardcoded humanoid model)', () => {
  it('compatibility/bearing follow each species reproduction mode', () => {
    // sexual (Tamar m/f): different-sex only, only 'f' bears
    expect(unionViable('tamar', 'm', 'tamar', 'f')).toBe(true);
    expect(unionViable('tamar', 'm', 'tamar', 'm')).toBe(false);
    expect(canBear('tamar', 'f')).toBe(true);
    expect(canBear('tamar', 'm')).toBe(false);
    // hermaphroditic (Vael, single sex): any two may bond, either may bear
    expect(unionViable('vael', 'vael', 'vael', 'vael')).toBe(true);
    expect(canBear('vael', 'vael')).toBe(true);
    // asexual (Grok): never pair-bonds, but the lone individual can bear
    expect(unionViable('grok', 'grok', 'grok', 'grok')).toBe(false);
    expect(canBear('grok', 'grok')).toBe(true);
  });

  it('hermaphroditic species actually form SAME-SEX pair-bonds in the sim', () => {
    // find a Vael-dominant focused settlement (all Vael share one sex) and confirm
    // marriages form between same-sex partners — impossible under the old opposite-sex rule.
    let found = false;
    for (let s = 1; s < 80 && !found; s++) {
      const w = createWorld(s);
      if (w.settlements[w.focusedSettlementId].macro.dominantSpecies !== 'vael') continue;
      runYears(w, 40);
      for (const [x, m] of w.rels) {
        for (const [y, e] of m) {
          if (
            e.flags.spouse &&
            w.identity.get(x)!.speciesId === 'vael' &&
            w.identity.get(y)!.speciesId === 'vael' &&
            w.identity.get(x)!.sex === w.identity.get(y)!.sex
          ) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    expect(found).toBe(true);
  });

  it('asexual species reproduce ALONE — single-parent births, and never wed', () => {
    const w = createWorld(5); // focused world
    const groks: number[] = [];
    for (let i = 0; i < 10; i++) {
      groks.push(
        createActor(w, { given: `G${i}`, family: 'Brood', sex: 'grok', speciesId: 'grok', profession: 'farmer', traits: [], ageYears: 18 }),
      );
    }
    runYears(w, 20);
    // a Grok bore offspring with exactly ONE parent (subjects = [child, bearer])
    const soloBirths = w.events.filter(
      (e) => e.type === 'born' && e.subjects.length === 2 && w.identity.get(e.subjects[1])?.speciesId === 'grok',
    );
    expect(soloBirths.length).toBeGreaterThan(0);
    // and no Grok ever took a spouse. Checked by id (not by surviving ties), since a
    // Grok may legitimately have emigrated and later died over the 20 years — what
    // must hold is that no marriage ever named one.
    const grokIds = new Set(groks);
    for (const g of groks) {
      const t = w.ties.get(g);
      if (t) expect(t.spouses.length).toBe(0); // for any still resident
    }
    const aGrokWed = w.events.some((e) => e.type === 'married' && e.subjects.some((s) => grokIds.has(s)));
    expect(aGrokWed).toBe(false);
  });
});
