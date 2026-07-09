/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). This file gathers the FAST blocks — pack-data / universe-agnosticism
 * checks and headless worldgen — that each cost little on their own.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, buildSnapshot, focusSettlement, hashWorld, forgeWorld } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { fullActors, summaryActors, createActor, emit, canTakeSpouse, allEvents } from './world';
import { generateGeography, isLand, freshWaterDist, seaDist } from './geography';
import { worldShapeFor } from './substrate';
import { ageCompatible } from './social';
import { renderEvent } from './render';
import { EVENT_RENDER, eventInterest } from '../content/narrative';
import { expand, type GrammarRules } from './grammar';
import { Rng } from './rng';
import { makeLanguage, coinWord } from './language';
import { tongueFor, kitFor, placeName, lexeme, peopleName, givenName, houseName } from '../content/languages';
import { resolveIntent } from '../systems/resolve';
import { EXTRA_ACTIONS } from '../content/actions';
import { maturityOf, elderhoodOf, fertileWindowOf, professionIncomeOf, ambitionOf, successionOf, hasLeader, leaderTitleOf, speciesById, RESOURCES, SUBSISTENCE_RESOURCE, PREMIUM_RESOURCE, NEEDS, SUBSISTENCE_NEED, WEALTH_NEED, SOCIAL_NEED, CULTURES } from '../content/fixture';
import { DAYS_PER_YEAR } from './model';
import { geoOf } from './determinism.helpers';

describe('worldgen (headless / all-aggregate mode)', () => {
  it('runs with no focused settlement and never creates a live actor', () => {
    const w = createWorld(7, false); // headless
    expect(w.focusedSettlementId).toBe(-1);
    expect(w.entities.length).toBe(0);
    runYears(w, 60);
    // the whole point: centuries pass with ZERO per-actor simulation
    expect(w.entities.length).toBe(0);
    expect(fullActors(w).length).toBe(0);
    expect(summaryActors(w).length).toBe(0);
    expect(w.focusedSettlementId).toBe(-1);
  });

  it('still advances the world: macro, director and chronicle all evolve', () => {
    const w = createWorld(7, false);
    const popBefore = w.settlements.map((s) => s.macro.population);
    runYears(w, 60);
    expect(w.settlements.some((s, i) => s.macro.population !== popBefore[i])).toBe(true);
    expect(w.chronicle.length).toBeGreaterThan(0); // a remembered past accrues
    expect(w.director.incidents).toBeGreaterThan(0); // the storyteller still paces it
  });

  it('headless worldgen is deterministic', () => {
    const run = () => {
      const w = createWorld(31415, false);
      runYears(w, 60);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });

  it('a snapshot of a headless world is coherent (no focused settlement)', () => {
    const w = createWorld(7, false);
    runYears(w, 80);
    const snap = buildSnapshot(w);
    expect(snap.focusedSettlementId).toBe(-1);
    expect(snap.simulatedInDetail).toBe(0);
    expect(snap.worldPopulation).toBeGreaterThan(0); // the aggregate world is alive
    expect(snap.settlements.every((s) => !s.detailed)).toBe(true);
  });

  it('the handoff works: a player can enter the pre-simulated world', () => {
    const w = createWorld(7, false);
    runYears(w, 60);
    const chronicleBefore = w.chronicle.length;
    // pick the largest surviving settlement and "enter" it
    let target = 0;
    for (const s of w.settlements) if (s.macro.population > w.settlements[target].macro.population) target = s.id;
    focusSettlement(w, target);
    expect(w.focusedSettlementId).toBe(target);
    expect(fullActors(w).length).toBeGreaterThan(0); // it materialized into a real place
    expect(w.chronicle.length).toBeGreaterThanOrEqual(chronicleBefore); // the deep past survived
    // and the live world keeps running from there
    runYears(w, 10);
    expect(w.events.length).toBeGreaterThan(0);
  });
});

describe('deep history (annals & ruins)', () => {
  it('the permanent annals keep the deep past the rolling chronicle forgets', () => {
    const w = createWorld(1492, false);
    runYears(w, 120);
    expect(w.annals.length).toBeGreaterThan(0);
    // foundings (year 0 landmarks) survive in the annals...
    expect(w.annals.some((t) => t.landmark && t.year === 0)).toBe(true);
    // ...but the rolling chronicle has faded everything ancient away
    const annalsOldest = Math.min(...w.annals.map((t) => t.year));
    const chronicleOldest = Math.min(...w.chronicle.map((t) => t.year));
    expect(annalsOldest).toBe(0);
    expect(chronicleOldest).toBeGreaterThan(annalsOldest);
    // the named ages span from the founding (year 0) to the present
    const snap = buildSnapshot(w);
    expect(snap.eras[0].year).toBe(0);
    expect(snap.eras[snap.eras.length - 1].year).toBeGreaterThan(50);
  });

  it('annals stay bounded but never prune away landmark foundings', () => {
    const w = createWorld(7, false);
    runYears(w, 400);
    expect(w.annals.length).toBeLessThanOrEqual(240);
    expect(w.annals.filter((t) => t.landmark && t.year === 0).length).toBeGreaterThan(0);
  });

  it('records a settlement falling to ruin (a permanent landmark)', () => {
    const w = createWorld(5, false);
    runYears(w, 3);
    const s = w.settlements.find((x) => !x.detailed && x.macro.population > 0)!;
    s.macro = { ...s.macro, population: 0, children: 0, adults: 0, elders: 0 };
    runYears(w, 1); // the yearly chronicle pass records the ruin
    expect(s.ruinedYear).toBeDefined();
    expect(w.events.some((e) => e.type === 'ruined' && e.data.name === s.name)).toBe(true);
    expect(w.annals.some((t) => t.landmark)).toBe(true);
  });

  it('the annals are deterministic across a headless worldgen', () => {
    const run = () => {
      const w = createWorld(31337, false);
      runYears(w, 100);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });
});

describe('worldgen orchestration (forgeWorld)', () => {
  it('forges a world with deep pre-history, then drops the player into it', () => {
    const w = forgeWorld(1492, 100);
    expect(w.focusedSettlementId).toBeGreaterThanOrEqual(0); // a settlement was entered
    expect(fullActors(w).length).toBeGreaterThan(0); // and it's live
    expect(Math.floor(w.tick / DAYS_PER_YEAR)).toBeGreaterThanOrEqual(100); // 100 forged years atop the grown pre-history
    expect(w.figures.length).toBeGreaterThan(10); // founders + rulers
    expect(w.annals.length).toBeGreaterThan(0); // a deep recorded past
    const snap = buildSnapshot(w);
    expect(snap.eras[0].year).toBe(0); // the named ages reach back to the founding
    expect(snap.historicalFigures.length).toBeGreaterThan(0);
  });

  it('the entered settlement is a survivor, not a ruin', () => {
    const w = forgeWorld(1492, 100);
    expect(w.settlements[w.focusedSettlementId].ruinedYear).toBeUndefined();
  });

  it('forgeWorld is deterministic from (seed, years)', () => {
    expect(hashWorld(forgeWorld(7, 80))).toBe(hashWorld(forgeWorld(7, 80)));
    expect(hashWorld(forgeWorld(7, 80))).not.toBe(hashWorld(forgeWorld(8, 80)));
    expect(hashWorld(forgeWorld(7, 80))).not.toBe(hashWorld(forgeWorld(7, 120)));
  });

  it('worldgen produces a VARIETY of events, not just plagues & famines', () => {
    const w = createWorld(1492, false);
    runYears(w, 150);
    const types = new Set(allEvents(w).map((e) => e.type));
    // memorable colour beyond disasters: wonders, beasts, omens — and, since 2E,
    // DIPLOMACY (sworn peaces legitimately suppress some of the old battle/raid
    // colour, replacing it with pacts and tributes — that IS the variety now).
    const flavour = ['wonder', 'beast', 'omen', 'battle', 'raid', 'pact_sealed', 'pact_refused', 'tribute_paid', 'tribute_refused'];
    expect(flavour.filter((t) => types.has(t as never)).length).toBeGreaterThanOrEqual(4);
  });
});

describe('historical figures', () => {
  it('worldgen mints a founder per settlement and a line of rulers (dynasties)', () => {
    const w = createWorld(1492, false);
    runYears(w, 80);
    for (const s of w.settlements) {
      expect(w.figures.some((f) => f.role === 'founder' && f.settlementId === s.id)).toBe(true);
    }
    expect(w.figures.filter((f) => f.role === 'ruler').length).toBeGreaterThan(0);
    // a surviving LED settlement has had a line of leaders across history (a leaderless
    // polity would have only its founder — no ongoing rule)
    const longLived = w.settlements.find(
      (s) => s.ruinedYear === undefined && s.macro.population > 0 && hasLeader(s.governmentId),
    )!;
    expect(w.figures.filter((f) => f.settlementId === longLived.id).length).toBeGreaterThan(1);
  });

  it('foundings & ruins name their figures; succession emits events', () => {
    const w = createWorld(1492, false);
    runYears(w, 80);
    const all = allEvents(w);
    const founding = all.find((e) => e.type === 'settlement_founded')!;
    expect(founding.subjects.length).toBe(1); // the founder
    expect(all.some((e) => e.type === 'ruler_died')).toBe(true);
    expect(all.some((e) => e.type === 'ascension')).toBe(true);
    // Invariant: whenever a settlement falls to (attrition) ruin, the event names its
    // last ruler. Searched across seeds/centuries so at least one ruin reliably occurs
    // regardless of demographic balance (a healthy world may have none for a while).
    let sawRuin = false;
    let sawNamedRuin = false;
    for (const seed of [1492, 7, 42, 99, 2024]) {
      const w2 = createWorld(seed, false);
      runYears(w2, 200);
      for (const e of allEvents(w2)) {
        if (e.type === 'ruined') {
          sawRuin = true;
          expect(e.subjects.length).toBeLessThanOrEqual(1); // a led polity names its last ruler; a leaderless one names none
          if (e.subjects.length === 1) sawNamedRuin = true;
        }
      }
    }
    expect(sawRuin).toBe(true);
    expect(sawNamedRuin).toBe(true); // when a polity that HAD a ruler falls, the ruin names them
  });

  it('figures are records, not actors — they never enter the entity systems', () => {
    const w = createWorld(7, false);
    runYears(w, 100);
    expect(w.figures.length).toBeGreaterThan(0);
    expect(w.entities.length).toBe(0); // not live actors
    expect(fullActors(w).length).toBe(0);
    expect(summaryActors(w).length).toBe(0);
    // but their names ARE in the registry, so events can render them
    expect(w.figures.every((f) => w.names.get(f.id) === f.name)).toBe(true);
  });

  it('the snapshot lists renowned historical figures', () => {
    const w = createWorld(1492, false);
    runYears(w, 80);
    const snap = buildSnapshot(w);
    expect(snap.historicalFigures.length).toBeGreaterThan(0);
    expect(snap.historicalFigures.some((f) => f.role === 'founder')).toBe(true);
    expect(snap.historicalFigures.every((f) => f.name.length > 0 && f.settlement.length > 0)).toBe(true);
  });
});

describe('per-species life stages (aging is species DATA, not a global constant)', () => {
  it('maturity, elderhood, and fertility scale with each species lifespan', () => {
    // lifespans: grok 54 < tamar 72 < vael 95 — life stages must follow, so a
    // long-lived and short-lived people do NOT age on one hardcoded human calendar.
    expect(maturityOf('grok')).toBeLessThan(maturityOf('tamar'));
    expect(maturityOf('tamar')).toBeLessThan(maturityOf('vael'));
    expect(elderhoodOf('grok')).toBeLessThan(elderhoodOf('vael'));
    expect(fertileWindowOf('grok')[1]).toBeLessThan(fertileWindowOf('vael')[1]);
  });

  it('marriage eligibility reads each actor’s OWN species maturity (real wiring)', () => {
    // Two 15-year-olds. A Grok matures at 13 → already an adult; a Vael matures at
    // 20 → not yet. Under the old GLOBAL adult age (16) the Grok pair would be
    // ineligible too, so this discriminates that aging now reads per-species data.
    const w = createWorld(1);
    const mk = (sex: 'm' | 'f', sp: string, age: number) =>
      createActor(w, { given: 'X', family: 'Y', sex, speciesId: sp, profession: 'farmer', traits: [], ageYears: age });
    const grokF = mk('f', 'grok', 15);
    const grokM = mk('m', 'grok', 15);
    const vaelF = mk('f', 'vael', 15);
    const vaelM = mk('m', 'vael', 15);
    expect(ageCompatible(w, grokF, grokM)).toBe(true); // adults by Grok maturity (13)
    expect(ageCompatible(w, vaelF, vaelM)).toBe(false); // not yet adult by Vael maturity (20)
  });
});

describe('the world is a SUBSTRATE (geography is one kind); worlds are diverse', () => {
  it('different seeds yield different archetypes and sizes — not one samey world', () => {
    const archetypes = new Set<string>();
    const sizes = new Set<number>();
    for (let seed = 1; seed <= 48; seed++) {
      archetypes.add(worldShapeFor(seed).archetype);
      sizes.add(createWorld(seed, false).settlements.length);
    }
    expect(archetypes.size).toBeGreaterThanOrEqual(3); // several world archetypes appear
    expect(sizes.size).toBeGreaterThanOrEqual(4); // and regions vary in size (richness)
  });

  it('the substrate is deterministic (regenerated from the seed, never serialized)', () => {
    const a = createWorld(7, false);
    const b = createWorld(7, false);
    expect(a.substrate.kind).toBe(b.substrate.kind);
    expect(a.settlements.map((s) => s.name)).toEqual(b.settlements.map((s) => s.name));
    expect(a.settlements.map((s) => s.pos.x)).toEqual(b.settlements.map((s) => s.pos.x));
  });

  it('CAPSTONE: a STARFIELD world founds, feeds & connects with no land at all', () => {
    let seed = 1;
    while (worldShapeFor(seed).kind !== 'starfield') seed++; // find a galaxy
    const w = createWorld(seed, false);
    expect(w.substrate.kind).toBe('starfield'); // a space world, same engine
    expect(w.settlements.length).toBeGreaterThanOrEqual(8); // a galaxy of star systems
    expect(w.edges.length).toBeGreaterThan(w.settlements.length); // linked by jump routes
    runYears(w, 60);
    const alive = w.settlements.filter((s) => s.macro.population > 0).length;
    expect(alive).toBeGreaterThanOrEqual(Math.ceil(w.settlements.length / 2)); // a viable galaxy
  });
});

describe('climate & biomes (temperature × moisture drive the map and the economy)', () => {
  it('temperature is deterministic and follows latitude (one pole cold, the other warm)', () => {
    const g = generateGeography(7);
    expect(g.temperature.length).toBe(g.elevation.length);
    const N = g.size;
    let topSum = 0;
    let botSum = 0;
    for (let i = 0; i < N; i++) {
      topSum += g.temperature[i];
      botSum += g.temperature[(N - 1) * N + i];
    }
    expect(botSum / N).toBeGreaterThan(topSum / N); // warmer toward the equatorward edge
    expect(Array.from(generateGeography(7).temperature)).toEqual(Array.from(g.temperature)); // deterministic
  });

  it('biomes give a surface world a VARIED economy — climate, not one fertility number', () => {
    // most worlds span several crafts; a single-climate world (e.g. all-boreal) has fewer,
    // so scan for a climatically varied surface world to make the point.
    let specs = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const w = createWorld(seed, false);
      if (w.substrate.kind !== 'surface') continue;
      specs = new Set(w.settlements.map((s) => s.econ.specialization));
      if (specs.size >= 3) break;
    }
    expect(specs.size).toBeGreaterThanOrEqual(3); // farming / forestry / ranching / fishing…
  });
});

describe('the world is GROWN through a pre-history (peoples spread into territories)', () => {
  it('settlements have a founding timeline and same-culture peoples form territories', () => {
    let w = createWorld(4, false);
    for (let seed = 4; w.substrate.kind !== 'surface'; seed++) w = createWorld(seed, false);
    // founded over centuries, not all dropped at year 0
    const years = w.settlements.map((s) => s.foundedYear);
    expect(new Set(years).size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...years)).toBeGreaterThan(0);
    // a people occupies a contiguous REGION: same-culture pairs are nearer than cross-culture
    const ss = w.settlements;
    let sameSum = 0;
    let sameN = 0;
    let diffSum = 0;
    let diffN = 0;
    for (let i = 0; i < ss.length; i++)
      for (let j = i + 1; j < ss.length; j++) {
        const d = Math.hypot(ss[i].pos.x - ss[j].pos.x, ss[i].pos.y - ss[j].pos.y);
        if (ss[i].cultureId === ss[j].cultureId) {
          sameSum += d;
          sameN++;
        } else {
          diffSum += d;
          diffN++;
        }
      }
    expect(sameN).toBeGreaterThan(0);
    expect(diffN).toBeGreaterThan(0);
    expect(sameSum / sameN).toBeLessThan(diffSum / diffN); // territories, not a random scatter
  });
});

describe('geography is the world substrate (drives where civilizations are founded)', () => {
  it('geography is deterministic from the seed', () => {
    const a = generateGeography(123);
    const b = generateGeography(123);
    expect(a.water).toEqual(b.water);
    expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation));
    const c = generateGeography(124);
    expect(Array.from(a.elevation)).not.toEqual(Array.from(c.elevation));
  });

  it('settlements are founded on land near water — not at random in the void', () => {
    for (const seed of [1, 7, 42, 1492, 2024]) {
      const w = createWorld(seed, false);
      if (w.substrate.kind !== 'surface') continue; // this invariant is about land worlds
      const geo = geoOf(w);
      for (const s of w.settlements) {
        expect(isLand(geo, s.pos.x, s.pos.y)).toBe(true); // never in the sea
      }
      // most sit within reach of fresh water (a few relaxed fallbacks may not)
      const watered = w.settlements.filter((s) => freshWaterDist(geo, s.pos.x, s.pos.y) <= 8).length;
      expect(watered).toBeGreaterThanOrEqual(Math.ceil(w.settlements.length * 0.6));
    }
  });

  it('the land sets a settlement’s trade and how great it can grow', () => {
    let w = createWorld(7, false);
    for (let seed = 7; w.substrate.kind !== 'surface'; seed++) w = createWorld(seed, false); // a land world
    const geo = geoOf(w);
    // a coastal site trades (goods) more than the most landlocked one
    const bySea = [...w.settlements].sort(
      (a, b) => seaDist(geo, a.pos.x, a.pos.y) - seaDist(geo, b.pos.x, b.pos.y),
    );
    expect(bySea[0].econ.production.goods).toBeGreaterThan(bySea[bySea.length - 1].econ.production.goods);
    // carrying capacity varies with the land — generous ground breeds great cities
    const caps = w.settlements.map((s) => s.capacity);
    expect(Math.max(...caps)).toBeGreaterThan(Math.min(...caps) + 0.2);
  });
});

describe('actions are a pack vocabulary (the engine resolves verbs it never declared)', () => {
  it('a pack can register a new action verb the engine dispatches', () => {
    const w = createWorld(5);
    runYears(w, 6);
    const actor = fullActors(w)[0];
    let salutedBy: number | undefined;
    EXTRA_ACTIONS['salute'] = (_world, a) => {
      salutedBy = a;
    };
    try {
      resolveIntent(w, actor, { kind: 'salute' }, new Rng(1)); // a verb unknown to the engine
      expect(salutedBy).toBe(actor); // dispatched through the pack registry
    } finally {
      delete EXTRA_ACTIONS['salute'];
    }
  });
});

describe('marriage is not assumed monogamous (monogamy is species data)', () => {
  it('a non-monogamous people may take another spouse; a monogamous one may not', () => {
    const w = createWorld(1);
    runYears(w, 8);
    const [a, b] = fullActors(w);
    w.ties.get(a)!.spouses.push(b); // a is now wed to b
    const sp = speciesById(w.identity.get(a)!.speciesId);
    const orig = sp.reproduction.monogamous;
    try {
      sp.reproduction.monogamous = true;
      expect(canTakeSpouse(w, a)).toBe(false); // already wed + monogamous => cannot wed again
      sp.reproduction.monogamous = false;
      expect(canTakeSpouse(w, a)).toBe(true); // a non-monogamous people still may
    } finally {
      sp.reproduction.monogamous = orig;
    }
  });
});

describe('macro demography is species-data driven', () => {
  it('aggregate reproduction is DATA: a non-breeding people does not grow', () => {
    const speciesId = createWorld(7, false).settlements.find((s) => s.macro.population > 20)!.macro.dominantSpecies;
    const sp = speciesById(speciesId);
    // net population change over 25 years for the chosen species' settlement, at a given
    // aggregate fertility (mutating the shared species object, restored each run).
    const netGrowth = (macroFertility: number): number => {
      const orig = sp.reproduction.macroFertility;
      sp.reproduction.macroFertility = macroFertility;
      try {
        const w = createWorld(7, false);
        const s = w.settlements.find((x) => x.macro.dominantSpecies === speciesId && x.macro.population > 20)!;
        const before = s.macro.population;
        runYears(w, 25);
        return s.macro.population - before;
      } finally {
        sp.reproduction.macroFertility = orig;
      }
    };
    const breeding = netGrowth(1); // an ordinary people
    const sterile = netGrowth(0); // a construct society that never breeds
    expect(sterile).toBeLessThan(breeding); // species DATA, not a fixed human rate, drives growth
  });
});

describe('procedural philology (each culture names the world in its own tongue)', () => {
  it('a tongue is deterministic, and different cultures sound different', () => {
    const kit = kitFor('martial');
    expect(makeLanguage(new Rng(5), kit)).toEqual(makeLanguage(new Rng(5), kit)); // same seed+kit ⇒ same tongue
    // the cultures get audibly different phonologies — their consonant sets aren't all identical
    const onsetSets = new Set(CULTURES.map((c) => tongueFor(c.id, 1).onsets.join('|')));
    expect(onsetSets.size).toBeGreaterThan(1);
    // the PALETTE lives in the pack, not the engine: a guttural creed and a flowing folk draw
    // on genuinely different sound-sets (the agnosticism that makes other universes portable).
    const guttural = new Set(kitFor('martial').onsetsSingle);
    const flowing = new Set(kitFor('sylvan').onsetsSingle);
    let shared = 0;
    for (const s of guttural) if (flowing.has(s)) shared++;
    expect(shared).toBeLessThan(Math.min(guttural.size, flowing.size)); // not the same palette
  });

  it('coins valid, single-word, deterministic names', () => {
    const lang = tongueFor('martial', 1);
    expect(coinWord(lang, new Rng(9), 'place')).toBe(coinWord(lang, new Rng(9), 'place'));
    const name = coinWord(lang, new Rng(9), 'place');
    expect(name).toMatch(/^[A-Z][a-z]+$/); // a capitalised single word, no spaces/digits
  });

  it('settlements SOUND like their people — a culture’s towns rhyme more than strangers do', () => {
    const charset = (s: string) => new Set(s.toLowerCase());
    const jaccard = (a: string, b: string) => {
      const A = charset(a), B = charset(b);
      let inter = 0;
      for (const c of A) if (B.has(c)) inter++;
      return inter / (A.size + B.size - inter);
    };
    let same = 0, sameN = 0, cross = 0, crossN = 0;
    for (let seed = 1; seed < 10; seed++) {
      const w = createWorld(seed);
      const byCulture = new Map<string, string[]>();
      for (const s of w.settlements) {
        const arr = byCulture.get(s.cultureId) ?? [];
        arr.push(s.name);
        byCulture.set(s.cultureId, arr);
      }
      for (const names of byCulture.values()) {
        for (let i = 0; i < names.length; i++)
          for (let j = i + 1; j < names.length; j++) {
            same += jaccard(names[i], names[j]);
            sameN++;
          }
      }
      const cultures = [...byCulture.keys()];
      for (let i = 0; i < cultures.length; i++)
        for (let j = i + 1; j < cultures.length; j++) {
          cross += jaccard(byCulture.get(cultures[i])![0], byCulture.get(cultures[j])![0]);
          crossN++;
        }
    }
    expect(sameN).toBeGreaterThan(0);
    expect(crossN).toBeGreaterThan(0);
    expect(same / sameN).toBeGreaterThan(cross / crossN);
  });

  it('names MEAN something, in VARIED structures — the ways real toponyms are made', () => {
    const inland = { coast: 0, elevation: 0.7, moisture: 0.3, temperature: 0.5, freshWater: 0.2 };
    expect(placeName('martial', 1, inland, new Rng(3))).toEqual(placeName('martial', 1, inland, new Rng(3))); // deterministic
    // every gloss is a known shape; every name is a single capitalised word; the STRUCTURE varies
    const shapes = new Set<string>();
    for (let s = 0; s < 60; s++) {
      const nm = placeName('martial', 1, inland, new Rng(s));
      expect(nm.name).toMatch(/^[A-Z][a-z]+$/);
      const compound = /^the \w+ \w+$/.test(nm.meaning); // "the iron haven" / "the grey stead"
      const possessive = /^[A-Z][a-z]+'s \w+$/.test(nm.meaning); // "Ereth's ford"
      const founderkin = /^home of [A-Z][a-z]+'s folk$/.test(nm.meaning); // the -ingham pattern
      expect(compound || possessive || founderkin).toBe(true);
      shapes.add(founderkin ? 'kin' : possessive ? 'poss' : nm.meaning.endsWith(' stead') ? 'loc' : 'compound');
    }
    expect(shapes.size).toBeGreaterThan(2); // several naming traditions in play, not one template
    // the place-kind reflects the LAND: a coastal people's names reach for coastal kinds, a
    // highland people's for peaks (across the templates that carry a land-kind).
    const coast = { coast: 0.9, elevation: 0.2, moisture: 0.5, temperature: 0.5, freshWater: 0.3 };
    const peak = { coast: 0, elevation: 0.8, moisture: 0.3, temperature: 0.5, freshWater: 0.2 };
    let coastHit = false, peakHit = false;
    for (let s = 0; s < 60; s++) {
      if (/haven|port|strand|cove|bay|point|sands|cliff|quay/.test(placeName('artisan', 1, coast, new Rng(s)).meaning)) coastHit = true;
      if (/hold|peak|crag|tor|pass|cairn|fell/.test(placeName('artisan', 1, peak, new Rng(s)).meaning)) peakHit = true;
    }
    expect(coastHit).toBe(true);
    expect(peakHit).toBe(true);
  });

  it('a town by a named river can take the river’s name; a colony can take its mother’s', () => {
    const inland = { coast: 0, elevation: 0.4, moisture: 0.5, temperature: 0.5, freshWater: 0.8 };
    // hydronym: given a landmark, some rolls borrow its (old-tongue) name — "the ford on the Skarnald"
    let hydro: { name: string; meaning: string } | undefined;
    for (let s = 0; s < 60 && !hydro; s++) {
      const nm = placeName('artisan', 1, inland, new Rng(s), { landmark: { name: 'Skarnald', kind: 'river' } });
      if (nm.meaning.includes('Skarnald')) hydro = nm;
    }
    expect(hydro).toBeDefined();
    expect(hydro!.meaning).toMatch(/^the \w+ (of|on|over) the Skarnald$/);
    expect(hydro!.name.toLowerCase()).toContain('skarnald'); // the dead name lives on in the town's
    // colonial transfer: a daughter can commemorate or orient by her mother city
    let colonial: { name: string; meaning: string } | undefined;
    for (let s = 0; s < 60 && !colonial; s++) {
      const nm = placeName('artisan', 1, inland, new Rng(s), { parent: { name: 'Kordul', dx: 0, dy: -10 } });
      if (nm.meaning.includes('Kordul')) colonial = nm;
    }
    expect(colonial).toBeDefined();
    expect(colonial!.meaning).toMatch(/^(new|north|south|east|west) Kordul$/);
  });

  it('a people has a self-name (demonym) in its own tongue, stable per world', () => {
    const a = peopleName('martial', 1);
    expect(a).toMatch(/^[A-Z][a-z]+$/);
    expect(peopleName('martial', 1)).toBe(a); // stable within a world
    expect(peopleName('sylvan', 1)).not.toBe(a); // different peoples sound different
  });

  it('people are named in their CULTURE’s tongue, and Houses carry meaningful epithets', () => {
    // given names are cultural + deterministic; different tongues sound different
    expect(givenName('martial', 1, new Rng(4))).toBe(givenName('martial', 1, new Rng(4)));
    expect(givenName('martial', 1, new Rng(4))).toMatch(/^[A-Z][a-z]+$/);
    // a House name MEANS a heraldic epithet ("Korthan — the Iron Hand")
    const h = houseName('sylvan', 1, new Rng(9));
    expect(h.name).toMatch(/^[A-Z][a-z]+$/);
    expect(h.meaning).toMatch(/^the \w+ \w+$/);
    // a world remembers its Houses' meanings, and they survive save/load
    const w = createWorld(1);
    expect(w.houseMeaning.size).toBeGreaterThan(0);
    for (const [surname, meaning] of w.houseMeaning) {
      expect(surname).toMatch(/^[A-Z][a-z]+$/);
      expect(meaning).toMatch(/^the \w+ \w+$/);
    }
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect([...loaded.houseMeaning]).toEqual([...w.houseMeaning]);
  });

  it('the lexicon is consistent — one concept keeps one root within a tongue', () => {
    expect(lexeme('martial', 1, 'iron')).toBe(lexeme('martial', 1, 'iron')); // stable
    expect(lexeme('martial', 1, 'iron')).not.toBe(lexeme('martial', 1, 'hold')); // distinct concepts
    expect(lexeme('martial', 1, 'iron').length).toBeGreaterThan(0);
    // a settlement carries its meaning into the world (createWorld stores it)
    const w = createWorld(1);
    expect(w.settlements.some((s) => typeof s.nameMeaning === 'string' && /^the /.test(s.nameMeaning))).toBe(true);
  });
});

describe('the feed carries curation signal (so the UI can declutter the banal)', () => {
  it('every feed event is scored by interest + flagged local/player', () => {
    const w = createWorld(1);
    runYears(w, 40);
    const snap = buildSnapshot(w);
    expect(snap.recentEvents.length).toBeGreaterThan(0);
    for (const e of snap.recentEvents) {
      expect(typeof e.interest).toBe('number');
      expect(typeof e.local).toBe('boolean');
      expect(typeof e.involvesPlayer).toBe('boolean');
    }
    // chitchat scores 0 (digested/dropped); landmarks score high (always shown)
    for (const e of snap.recentEvents) {
      if (['born', 'friendship', 'kindness', 'dispute', 'brawl'].includes(e.type)) expect(e.interest).toBe(0);
      if (['conquest', 'ruined', 'settlement_founded', 'dynasty', 'house_fallen'].includes(e.type)) {
        expect(e.interest).toBeGreaterThan(0);
      }
    }
    // the focused settlement's own happenings are flagged so the feed can always keep them
    expect(snap.recentEvents.some((e) => e.local)).toBe(true);
  });
});

describe('resources & needs are pack-defined vectors (engine reads roles, not literals)', () => {
  it('the role resources/needs are members of the pack vectors', () => {
    expect(RESOURCES).toContain(SUBSISTENCE_RESOURCE);
    expect(RESOURCES).toContain(PREMIUM_RESOURCE);
    expect(NEEDS).toContain(SUBSISTENCE_NEED);
    expect(NEEDS).toContain(WEALTH_NEED);
    expect(NEEDS).toContain(SOCIAL_NEED);
  });

  it('a settlement economy covers the whole RESOURCES vector', () => {
    const w = createWorld(1);
    for (const s of w.settlements) {
      for (const r of RESOURCES) {
        expect(typeof s.econ.stock[r]).toBe('number');
        expect(typeof s.econ.price[r]).toBe('number');
      }
    }
  });

  it('the engine initializes actors over the pack NEEDS vector — including a pack-added need', () => {
    NEEDS.push('faith'); // a pack introduces a need the engine never declared
    try {
      const w = createWorld(1); // focused world materializes actors
      const id = fullActors(w)[0];
      const needs = w.needs.get(id)!;
      for (const k of NEEDS) expect(typeof needs[k]).toBe('number'); // every need present...
      expect(needs['faith']).toBe(500); // ...including the new one, with no engine change
    } finally {
      NEEDS.pop();
    }
  });
});

describe('government is DATA (leadership transfer is not a hardcoded dynasty)', () => {
  it('the pack defines succession modes and leader titles', () => {
    expect(successionOf('monarchy')).toBe('hereditary');
    expect(successionOf('council')).toBe('elected');
    expect(successionOf('freefolk')).toBe('none');
    expect(hasLeader('monarchy')).toBe(true);
    expect(hasLeader('freefolk')).toBe(false); // leaderless
    expect(leaderTitleOf('council')).toBe('Speaker');
  });

  it('leaderless polities have no ruler; hereditary die in office; elected rotate while living', () => {
    let leaderlessSeen = false;
    let hereditaryDies = false;
    let electedRotatesAlive = false;
    for (let seed = 1; seed < 40 && !(leaderlessSeen && hereditaryDies && electedRotatesAlive); seed++) {
      const w = createWorld(seed, false);
      runYears(w, 80);
      for (const s of w.settlements) {
        const mode = successionOf(s.governmentId);
        if (mode === 'none') {
          // a leaderless polity NEVER has a ruler
          expect(s.currentRulerId).toBeUndefined();
          leaderlessSeen = true;
        }
      }
      // hereditary rulers die in office (a dynasty of ruler_died → ascension)
      if (w.events.some((e) => e.type === 'ruler_died')) hereditaryDies = true;
      // an elected polity accumulates several leaders over 200y, NONE of whom died in
      // office (they step down alive — no deathYear) — impossible under the old model.
      for (const s of w.settlements) {
        if (successionOf(s.governmentId) !== 'elected') continue;
        const rulers = w.figures.filter((f) => f.settlementId === s.id && f.role === 'ruler');
        if (rulers.length >= 2 && rulers.every((f) => f.deathYear === undefined)) {
          electedRotatesAlive = true;
          break;
        }
      }
    }
    expect(leaderlessSeen).toBe(true);
    expect(hereditaryDies).toBe(true);
    expect(electedRotatesAlive).toBe(true);
  });
});

describe('event vocabulary is pack-owned (the engine is narration-agnostic)', () => {
  it('prose and interest come from the pack, not the engine', () => {
    // the templates/weights live in content/narrative.ts; engine modules only consume them
    expect(typeof EVENT_RENDER['married']).toBe('function');
    expect(eventInterest('died_brawl', {})).toBeGreaterThan(eventInterest('born', {}));
    const w = createWorld(1);
    const founding = w.events.find((e) => e.type === 'settlement_founded')!;
    const prose = renderEvent(w, founding);
    expect(prose.length).toBeGreaterThan(0);
    expect(prose).not.toBe(founding.type); // a real sentence, not the raw type
  });

  it('a pack may emit & render an event type the ENGINE never declared', () => {
    const w = createWorld(1);
    // emit a type the engine has no knowledge of — the open EventType permits it
    const id = emit(w, 'warp_jump', [], { from: 'Terra', to: 'Vega' });
    const ev = w.events.find((e) => e.id === id)!;
    // with no pack template, it falls back gracefully to the raw type (no crash)
    expect(renderEvent(w, ev)).toBe('warp_jump');
    expect(eventInterest('warp_jump', {})).toBe(0); // unknown → routine
    // and when the PACK supplies a template, the engine renders it generically
    EVENT_RENDER['warp_jump'] = (_n, d) => `A ship jumped from ${d.from} to ${d.to}.`;
    try {
      expect(renderEvent(w, ev)).toBe('A ship jumped from Terra to Vega.');
    } finally {
      delete EVENT_RENDER['warp_jump'];
    }
  });
});

describe('trait & profession effects are pack DATA, not engine branches', () => {
  it('profession income and trait ambition are read from the pack, with neutral fallbacks', () => {
    // income lives on the profession (was a hardcoded map in resolve.ts)
    expect(professionIncomeOf('trader')).toBe(6);
    expect(professionIncomeOf('farmer')).toBe(3);
    expect(professionIncomeOf('nonesuch')).toBe(3); // engine never needs to know pack names
    // ambition lives on the trait (was `traits.includes('proud')` in aspiration/figures)
    expect(ambitionOf(['proud'])).toBeGreaterThan(0);
    expect(ambitionOf(['kind', 'loyal'])).toBe(0);
    expect(ambitionOf(['kind', 'proud'])).toBeGreaterThan(0); // any ambitious trait counts
  });
});

describe('grammar', () => {
  it('expands recursively with bindings, and is deterministic per seed', () => {
    const rules: GrammarRules = {
      greet: ['[hi] [NAME]!'],
      hi: ['Hail', 'Greetings', 'Well met'],
    };
    const out1 = expand(rules, 'greet', new Rng(123), { NAME: 'Bron' });
    const out2 = expand(rules, 'greet', new Rng(123), { NAME: 'Bron' });
    expect(out1).toBe(out2); // deterministic
    expect(out1.endsWith('Bron!')).toBe(true); // binding injected
    expect(['Hail Bron!', 'Greetings Bron!', 'Well met Bron!']).toContain(out1);
  });

  it('respects weights and handles unknown symbols gracefully', () => {
    const rules: GrammarRules = { x: [['A', 100], ['B', 1]] };
    let aCount = 0;
    for (let i = 0; i < 50; i++) if (expand(rules, 'x', new Rng(i)) === 'A') aCount++;
    expect(aCount).toBeGreaterThan(40); // the heavy weight dominates
    expect(expand(rules, 'missing', new Rng(1))).toBe(''); // unknown symbol -> empty
  });
});

