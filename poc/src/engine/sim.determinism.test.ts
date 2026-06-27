/**
 * The determinism gate. MythOS's core invariant: same seed + same code (and same
 * sequence of intents, including LOD focus changes) => byte-identical world.
 * If this goes red, a non-deterministic input has crept into the sim.
 */
import { describe, it, expect } from 'vitest';
import {
  runHeadless,
  hashWorld,
  canonicalize,
  runYears,
  createWorld,
  buildSnapshot,
  focusSettlement,
  setStoryteller,
  forgeWorld,
  possess,
  schedulePlayerIntent,
} from './sim';
import { resolveIntent, resolvePlayerIntent } from '../systems/resolve';
import { EXTRA_ACTIONS } from '../content/actions';
import { fullActors, summaryActors, createActor, emit, canTakeSpouse } from './world';
import { generateGeography, isLand, freshWaterDist, seaDist } from './geography';
import { SurfaceSubstrate, worldShapeFor } from './substrate';
const geoOf = (w: World) => (w.substrate as SurfaceSubstrate).geography;
import { ageCompatible } from './social';
import { renderEvent } from './render';
import { EVENT_RENDER, eventInterest } from '../content/narrative';
import { addThought, computeOpinion, opinionReasons } from './opinion';
import { interestOf } from './chronicle';
import { expand, type GrammarRules } from './grammar';
import { Rng } from './rng';
import { BASE_PRICE, maturityOf, elderhoodOf, fertileWindowOf, professionIncomeOf, ambitionOf, unionViable, canBear, successionOf, hasLeader, leaderTitleOf, speciesById, RESOURCES, SUBSISTENCE_RESOURCE, PREMIUM_RESOURCE, NEEDS, SUBSISTENCE_NEED, WEALTH_NEED, SOCIAL_NEED, VALUES, CULTURES, culturalDistance, mostOpposedValue, THOUGHT_SPECS } from '../content/fixture';
import { DAYS_PER_YEAR, ADULT_AGE, type World, type RelEdge, type WorldEvent, type EventType } from './model';
import { type Intent } from './intent';

/** A fixed session: advance, shift focus across settlements, advance again. */
function scriptedRun(seed: number): World {
  const w = createWorld(seed);
  runYears(w, 20);
  focusSettlement(w, 3);
  runYears(w, 20);
  focusSettlement(w, 7);
  runYears(w, 20);
  focusSettlement(w, 1);
  runYears(w, 15);
  return w;
}

describe('determinism', () => {
  it('two runs with the same seed produce identical worlds', () => {
    const a = runHeadless(123456, 60);
    const b = runHeadless(123456, 60);
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('is stable across several seeds', () => {
    for (const seed of [1, 7, 42, 99, 2024]) {
      expect(hashWorld(runHeadless(seed, 40))).toBe(hashWorld(runHeadless(seed, 40)));
    }
  });

  it('different seeds diverge (proves novelty, not a frozen world)', () => {
    const hs = [1, 2, 3].map((s) => hashWorld(runHeadless(s, 60)));
    expect(new Set(hs).size).toBe(3);
  });

  it('running in two steps equals running in one (composability of ticks)', () => {
    const oneShot = runHeadless(777, 50);
    const split = runHeadless(777, 30);
    runYears(split, 20);
    expect(hashWorld(split)).toBe(hashWorld(oneShot));
  });

  // ---- LOD-specific determinism ----

  it('a scripted session with focus changes is fully reproducible', () => {
    expect(hashWorld(scriptedRun(31337))).toBe(hashWorld(scriptedRun(31337)));
    expect(canonicalize(scriptedRun(42))).toBe(canonicalize(scriptedRun(42)));
  });

  it('different focus scripts on the same seed diverge', () => {
    const a = createWorld(555);
    runYears(a, 40);
    const b = createWorld(555);
    focusSettlement(b, 4);
    runYears(b, 40);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});

// ---- player-as-actor determinism rails ----

/** First two living adults of the focused settlement: the player and a target. */
function pickPlayerAndTarget(w: World): { player: number; target: number } {
  const adults = fullActors(w).filter(
    (id) => w.lifecycle.get(id)!.alive && w.lifecycle.get(id)!.ageYears >= ADULT_AGE,
  );
  return { player: adults[0], target: adults[adults.length - 1] };
}

/** A scripted player session: possess an adult and feed a fixed sequence of
 *  intents at every weekly act tick for 5 years. With `act = false` the player is
 *  possessed but only idles (does nothing), so the world differs only by the
 *  player's actions. */
function playerRun(seed: number, act: boolean): World {
  const w = createWorld(seed);
  const { player, target } = pickPlayerAndTarget(w);
  possess(w, player);
  if (act) {
    for (let tick = 7; tick <= 5 * DAYS_PER_YEAR; tick += 7) {
      const k = (tick / 7) % 4;
      const intent: Intent =
        k === 0
          ? { kind: 'give', target }
          : k === 1
            ? { kind: 'socialize', target }
            : k === 2
              ? { kind: 'court', target }
              : { kind: 'work' };
      schedulePlayerIntent(w, tick, intent);
    }
  }
  runYears(w, 5);
  return w;
}

describe('player-as-actor (determinism rails)', () => {
  it('a scripted player session is fully reproducible', () => {
    expect(hashWorld(playerRun(99, true))).toBe(hashWorld(playerRun(99, true)));
    expect(canonicalize(playerRun(42, true))).toBe(canonicalize(playerRun(42, true)));
  });

  it('re-feeding the recorded input log reconstructs the world (replay)', () => {
    const live = playerRun(99, true);

    // a fresh world, same possession, fed ONLY the recorded input log, reproduces
    // the exact same world — proving the log is sufficient player state for replay.
    const replay = createWorld(99);
    const { player } = pickPlayerAndTarget(replay);
    possess(replay, player);
    replay.playerInputs = live.playerInputs.map((e) => ({ ...e }));
    runYears(replay, 5);

    expect(hashWorld(replay)).toBe(hashWorld(live));
  });

  it('the player actually changes history (inputs matter)', () => {
    expect(hashWorld(playerRun(99, true))).not.toBe(hashWorld(playerRun(99, false)));
  });

  it("the player's randomness is isolated from the NPC stream", () => {
    const w = createWorld(7);
    runYears(w, 2); // populate adult relationships
    const { player, target } = pickPlayerAndTarget(w);
    possess(w, player);

    const worldRngBefore = w.rng.state;
    const playerRngBefore = w.playerRngState;
    resolvePlayerIntent(w, player, { kind: 'socialize', target });

    expect(w.rng.state).toBe(worldRngBefore); // shared settlement stream untouched
    expect(w.playerRngState).not.toBe(playerRngBefore); // player stream advanced
  });
});

describe('level-of-detail / scale', () => {
  it('world population vastly exceeds the count simulated in detail', () => {
    const w = runHeadless(42, 30);
    const snap = buildSnapshot(w);
    expect(snap.settlements.length).toBeGreaterThanOrEqual(6); // a region of several settlements
    expect(snap.settlements.filter((s) => s.detailed).length).toBe(1);
    expect(snap.worldPopulation).toBeGreaterThan(snap.simulatedInDetail * 3);
    // live entities stay bounded to the focused settlement only
    expect(w.entities.length).toBeLessThan(snap.worldPopulation);
  });

  it('aggregate settlements actually evolve over time', () => {
    const w = createWorld(42);
    const before = w.settlements[5].macro.population; // settlement 5 is aggregate
    runYears(w, 50);
    expect(w.settlements[5].detailed).toBe(false);
    expect(w.settlements[5].macro.population).not.toBe(before);
  });

  it('demote/promote keeps live-entity count bounded after many focus shifts', () => {
    const w = createWorld(99);
    for (let i = 0; i < 6; i++) {
      runYears(w, 10);
      focusSettlement(w, (i * 3 + 2) % 10);
    }
    const snap = buildSnapshot(w);
    const alive = w.entities.filter((id) => w.lifecycle.get(id)!.alive).length;
    // live actors are only the focused settlement (full) + named people (summary),
    // never the whole world
    expect(alive).toBe(snap.simulatedInDetail + snap.namedPeople);
    expect(alive).toBeLessThan(snap.worldPopulation);
    expect(snap.namedPeople).toBeLessThan(80); // summary tier stays bounded
  });

  it('notable individuals persist as summary actors after you focus away', () => {
    const w = createWorld(2024);
    runYears(w, 30);
    focusSettlement(w, 5);
    expect(w.settlements[0].detailed).toBe(false);
    const residents = summaryActors(w).filter((id) => w.homeSettlement.get(id) === 0);
    expect(residents.length).toBeGreaterThan(0);
  });
});

describe('summary tier + migration', () => {
  it('a summary actor keeps its identity when its settlement is re-focused', () => {
    const w = createWorld(11);
    runYears(w, 30);
    focusSettlement(w, 4); // settlement 0 demotes; its notables become summaries
    const survivor = summaryActors(w).find((id) => w.homeSettlement.get(id) === 0);
    expect(survivor).toBeDefined();
    const nameBefore = w.identity.get(survivor!)!.given;
    focusSettlement(w, 0); // back home — the summary should upgrade to full, same id
    expect(w.fidelity.get(survivor!)).toBe('full');
    expect(w.lifecycle.get(survivor!)!.alive).toBe(true);
    expect(w.identity.get(survivor!)!.given).toBe(nameBefore);
  });

  it('migration produces named people living across the world', () => {
    // Emigration moves named people out of the focused settlement to live elsewhere as
    // summary-tier actors. Summaries churn and die (cap per settlement), so any SINGLE
    // seed may momentarily have none at year 40 — assert the property holds across seeds.
    let found = false;
    for (let s = 1; s < 25 && !found; s++) {
      const w = createWorld(s);
      runYears(w, 40);
      const elsewhere = summaryActors(w).filter((id) => w.homeSettlement.get(id) !== w.focusedSettlementId);
      if (w.events.some((e) => e.type === 'emigrated') && elsewhere.length > 0) found = true;
    }
    expect(found).toBe(true);
  });

  it('live entities = full + summary, and stay bounded vs the world population', () => {
    const w = createWorld(7);
    runYears(w, 40);
    const snap = buildSnapshot(w);
    const alive = w.entities.filter((id) => w.lifecycle.get(id)!.alive).length;
    expect(alive).toBe(snap.simulatedInDetail + snap.namedPeople);
    expect(alive).toBeLessThan(snap.worldPopulation);
  });

  it('full actors reside in the focused settlement; summaries do not', () => {
    const w = createWorld(123);
    runYears(w, 25);
    for (const id of fullActors(w)) expect(w.homeSettlement.get(id)).toBe(w.focusedSettlementId);
    for (const id of summaryActors(w)) expect(w.homeSettlement.get(id)).not.toBe(w.focusedSettlementId);
  });
});

describe('region geography', () => {
  function connectedComponents(w: World): number {
    const n = w.settlements.length;
    const parent = [...Array(n).keys()];
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const e of w.edges) parent[find(e.a)] = find(e.b);
    return new Set([...Array(n).keys()].map(find)).size;
  }

  it('the settlement graph is connected and everyone has a neighbour', () => {
    const w = createWorld(42);
    expect(w.edges.length).toBeGreaterThanOrEqual(w.settlements.length - 1);
    const seen = new Set<number>();
    for (const e of w.edges) { seen.add(e.a); seen.add(e.b); }
    expect(seen.size).toBe(w.settlements.length); // no isolated settlement
    expect(connectedComponents(w)).toBe(1); // single connected region
  });

  it('edge relations stay in range and goods flow along the routes', () => {
    const w = createWorld(42);
    runYears(w, 60);
    for (const e of w.edges) {
      expect(e.relation).toBeGreaterThanOrEqual(-100);
      expect(e.relation).toBeLessThanOrEqual(100);
    }
    expect(w.edges.some((e) => e.tradeVolume > 0)).toBe(true); // goods actually moved
    expect(w.events.filter((e) => e.type === 'trade').length).toBeGreaterThan(0);
  });

  it('migration prefers nearer settlements (geography shapes movement)', () => {
    const w = createWorld(7);
    runYears(w, 80);
    const focused = w.settlements[w.focusedSettlementId];
    const distTo = (id: number) =>
      Math.hypot(focused.pos.x - w.settlements[id].pos.x, focused.pos.y - w.settlements[id].pos.y);
    const nameToId = new Map(w.settlements.map((s) => [s.name, s.id]));

    const emigrantDists: number[] = [];
    for (const ev of w.events) {
      if (ev.type !== 'emigrated') continue;
      const toId = nameToId.get(String(ev.data.to));
      if (toId !== undefined) emigrantDists.push(distTo(toId));
    }
    expect(emigrantDists.length).toBeGreaterThan(3);
    const emigrantAvg = emigrantDists.reduce((a, b) => a + b, 0) / emigrantDists.length;

    let total = 0;
    let count = 0;
    for (const s of w.settlements) if (s.id !== focused.id) { total += distTo(s.id); count++; }
    const allAvg = total / count;

    expect(emigrantAvg).toBeLessThan(allAvg); // emigrants land closer than chance
  });
});

describe('economy', () => {
  it('local food production drives prices: rich-farmland towns have cheaper food', () => {
    // a CLIMATICALLY MIXED surface world — some lush (food-surplus) towns and some poor
    // ones — so prices actually spread; a uniformly desert or grassland world (or a galaxy)
    // floors or ceilings every food price, where this scarcity property doesn't apply.
    let w = createWorld(42);
    for (let seed = 42; seed < 400; seed++) {
      w = createWorld(seed);
      if (w.substrate.kind !== 'surface') continue;
      const foods = w.settlements.map((s) => s.econ.production.food);
      if (Math.max(...foods) > 1.1 && Math.min(...foods) < 0.85) break;
    }
    runYears(w, 30);
    const live = w.settlements.filter((s) => !s.detailed && s.macro.population > 0);
    const byFood = [...live].sort((a, b) => b.econ.production.food - a.econ.production.food);
    const n = Math.max(1, Math.floor(byFood.length / 3));
    const avg = (arr: typeof live) => arr.reduce((s, x) => s + x.econ.price.food, 0) / arr.length;
    const high = avg(byFood.slice(0, n)); // the best farmland
    const low = avg(byFood.slice(-n)); // the poorest soil
    expect(high).toBeLessThan(low); // surplus → cheap, scarcity → dear

    // prices always stay within the clamp bounds
    for (const s of w.settlements) {
      expect(s.econ.price.food).toBeGreaterThanOrEqual(BASE_PRICE.food * 0.4 - 1e-6);
      expect(s.econ.price.food).toBeLessThanOrEqual(BASE_PRICE.food * 3.5 + 1e-6);
    }
  });

  it('the world runs a real economy: production, wealth, and trade volume', () => {
    const w = createWorld(7);
    const stockBefore = w.settlements.map((s) => ({ ...s.econ.stock }));
    runYears(w, 40);
    const snap = buildSnapshot(w);

    expect(snap.worldWealth).toBeGreaterThan(0);
    // at least one settlement's stocks changed from the initial state (production ran)
    const changed = w.settlements.some(
      (s, i) =>
        s.econ.stock.food !== stockBefore[i].food ||
        s.econ.stock.materials !== stockBefore[i].materials ||
        s.econ.stock.goods !== stockBefore[i].goods,
    );
    expect(changed).toBe(true);
    expect(w.edges.some((e) => e.tradeVolume > 0)).toBe(true);
  });

  it('trade keeps most settlements fed (the routes do their job)', () => {
    const w = createWorld(42);
    runYears(w, 50);
    const fed = w.settlements.filter((s) => s.macro.population > 0 && s.econ.stock.food / s.macro.population >= 0.5);
    const alive = w.settlements.filter((s) => s.macro.population > 0);
    expect(fed.length).toBeGreaterThan(alive.length / 2); // famine is the exception, not the rule
  });
});

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

describe('chronicle (tales)', () => {
  const mk = (type: EventType, data: Record<string, number | string> = {}): WorldEvent => ({
    id: 1,
    tick: 0,
    year: 0,
    type,
    subjects: [],
    data,
    causes: [],
  });

  it('interest scoring elevates dramatic events over routine ones', () => {
    expect(interestOf(mk('died_brawl'))).toBeGreaterThan(interestOf(mk('born')));
    expect(interestOf(mk('famine', { toll: 20 }))).toBeGreaterThan(interestOf(mk('married')));
    expect(interestOf(mk('feud'))).toBeGreaterThan(interestOf(mk('kindness')));
    expect(interestOf(mk('born'))).toBe(0); // routine — not remembered
  });

  it('the chronicle stays bounded and records the memorable past as legends', () => {
    const w = createWorld(42);
    runYears(w, 60);
    expect(w.chronicle.length).toBeGreaterThan(0);
    expect(w.chronicle.length).toBeLessThanOrEqual(60); // bounded
    const snap = buildSnapshot(w);
    expect(snap.chronicle.length).toBeGreaterThan(0);
    expect(snap.chronicle[0].text.length).toBeGreaterThan(0); // a rendered legend
  });

  it('named years are dramatic and deterministic', () => {
    const run = () => {
      const w = createWorld(42);
      runYears(w, 60);
      return buildSnapshot(w);
    };
    const a = run();
    const b = run();
    expect(a.eras).toEqual(b.eras); // reproducible
    expect(a.eras.length).toBeGreaterThan(0); // a lively world names some years
  });
});

describe('worldgen (headless / all-aggregate mode)', () => {
  it('runs with no focused settlement and never creates a live actor', () => {
    const w = createWorld(7, false); // headless
    expect(w.focusedSettlementId).toBe(-1);
    expect(w.entities.length).toBe(0);
    runYears(w, 120);
    // the whole point: centuries pass with ZERO per-actor simulation
    expect(w.entities.length).toBe(0);
    expect(fullActors(w).length).toBe(0);
    expect(summaryActors(w).length).toBe(0);
    expect(w.focusedSettlementId).toBe(-1);
  });

  it('still advances the world: macro, director and chronicle all evolve', () => {
    const w = createWorld(7, false);
    const popBefore = w.settlements.map((s) => s.macro.population);
    runYears(w, 120);
    expect(w.settlements.some((s, i) => s.macro.population !== popBefore[i])).toBe(true);
    expect(w.chronicle.length).toBeGreaterThan(0); // a remembered past accrues
    expect(w.director.incidents).toBeGreaterThan(0); // the storyteller still paces it
  });

  it('headless worldgen is deterministic', () => {
    const run = () => {
      const w = createWorld(31415, false);
      runYears(w, 150);
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
    runYears(w, 120);
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
    runYears(w, 200);
    expect(w.annals.length).toBeGreaterThan(0);
    // foundings (year 0 landmarks) survive 200 years in the annals...
    expect(w.annals.some((t) => t.landmark && t.year === 0)).toBe(true);
    // ...but the rolling chronicle has faded everything ancient away
    const annalsOldest = Math.min(...w.annals.map((t) => t.year));
    const chronicleOldest = Math.min(...w.chronicle.map((t) => t.year));
    expect(annalsOldest).toBe(0);
    expect(chronicleOldest).toBeGreaterThan(annalsOldest);
    // the named ages span from the founding (year 0) to the present
    const snap = buildSnapshot(w);
    expect(snap.eras[0].year).toBe(0);
    expect(snap.eras[snap.eras.length - 1].year).toBeGreaterThan(100);
  });

  it('annals stay bounded but never prune away landmark foundings', () => {
    const w = createWorld(7, false);
    runYears(w, 1000);
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
      runYears(w, 250);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });
});

describe('worldgen orchestration (forgeWorld)', () => {
  it('forges a world with deep pre-history, then drops the player into it', () => {
    const w = forgeWorld(1492, 200);
    expect(w.focusedSettlementId).toBeGreaterThanOrEqual(0); // a settlement was entered
    expect(fullActors(w).length).toBeGreaterThan(0); // and it's live
    expect(Math.floor(w.tick / DAYS_PER_YEAR)).toBe(200); // after 200 years of history
    expect(w.figures.length).toBeGreaterThan(10); // founders + rulers
    expect(w.annals.length).toBeGreaterThan(0); // a deep recorded past
    const snap = buildSnapshot(w);
    expect(snap.eras[0].year).toBe(0); // the named ages reach back to the founding
    expect(snap.historicalFigures.length).toBeGreaterThan(0);
  });

  it('the entered settlement is a survivor, not a ruin', () => {
    const w = forgeWorld(1492, 200);
    expect(w.settlements[w.focusedSettlementId].ruinedYear).toBeUndefined();
  });

  it('forgeWorld is deterministic from (seed, years)', () => {
    expect(hashWorld(forgeWorld(7, 150))).toBe(hashWorld(forgeWorld(7, 150)));
    expect(hashWorld(forgeWorld(7, 150))).not.toBe(hashWorld(forgeWorld(8, 150)));
    expect(hashWorld(forgeWorld(7, 150))).not.toBe(hashWorld(forgeWorld(7, 250)));
  });

  it('worldgen produces a VARIETY of events, not just plagues & famines', () => {
    const w = createWorld(1492, false);
    runYears(w, 300);
    const types = new Set(w.events.map((e) => e.type));
    const flavour = ['wonder', 'beast', 'omen', 'battle', 'raid'];
    expect(flavour.filter((t) => types.has(t as never)).length).toBeGreaterThanOrEqual(4);
  });
});

describe('historical figures', () => {
  it('worldgen mints a founder per settlement and a line of rulers (dynasties)', () => {
    const w = createWorld(1492, false);
    runYears(w, 150);
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
    runYears(w, 150);
    const founding = w.events.find((e) => e.type === 'settlement_founded')!;
    expect(founding.subjects.length).toBe(1); // the founder
    expect(w.events.some((e) => e.type === 'ruler_died')).toBe(true);
    expect(w.events.some((e) => e.type === 'ascension')).toBe(true);
    // Invariant: whenever a settlement falls to (attrition) ruin, the event names its
    // last ruler. Searched across seeds/centuries so at least one ruin reliably occurs
    // regardless of demographic balance (a healthy world may have none for a while).
    let sawRuin = false;
    let sawNamedRuin = false;
    for (const seed of [1492, 7, 42, 99, 2024]) {
      const w2 = createWorld(seed, false);
      runYears(w2, 600);
      for (const e of w2.events) {
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
    runYears(w, 150);
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
    runYears(w, 120);
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
    let w = createWorld(1, false);
    for (let seed = 1; w.substrate.kind !== 'surface'; seed++) w = createWorld(seed, false);
    const specs = new Set(w.settlements.map((s) => s.econ.specialization));
    expect(specs.size).toBeGreaterThanOrEqual(3); // farming / forestry / hunting / mining / fishing…
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
      runYears(w, 200);
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
    // and no Grok ever took a spouse
    for (const g of groks) expect(w.ties.get(g)?.spouses.length).toBe(0);
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

describe('director (storyteller)', () => {
  it('fires incidents that the world remembers, each emitting one summary event', () => {
    const w = createWorld(42);
    runYears(w, 60);
    expect(w.director.incidents).toBeGreaterThan(0);
    const directorTypes = new Set(['boon', 'blight', 'plague', 'wonder', 'beast', 'omen']);
    const incidentEvents = w.events.filter((e) => directorTypes.has(e.type));
    expect(incidentEvents.length).toBe(w.director.incidents);
  });

  it('personality changes how much drama is injected (grim > gentle)', () => {
    const incidents = (p: string) => {
      const w = createWorld(7);
      setStoryteller(w, p);
      runYears(w, 60);
      return w.director.incidents;
    };
    expect(incidents('grim')).toBeGreaterThan(incidents('gentle'));
  });

  it('is deterministic, including the choice of storyteller', () => {
    const run = (p: string) => {
      const w = createWorld(99);
      setStoryteller(w, p);
      runYears(w, 50);
      return hashWorld(w);
    };
    expect(run('grim')).toBe(run('grim')); // reproducible
    expect(run('grim')).not.toBe(run('gentle')); // a different storyteller => a different world
  });
});

// ---- audit fixes (logic-bug regressions) ----

describe('audit fixes', () => {
  it('the player is never involuntarily emigrated out of the focused settlement', () => {
    const w = createWorld(2024);
    runYears(w, 5);
    const young = fullActors(w).find((i) => {
      const a = w.lifecycle.get(i)!.ageYears;
      return a >= 18 && a <= 30;
    })!;
    possess(w, young);
    runYears(w, 25); // migration fires yearly; without the guard the player could be moved
    if (w.lifecycle.get(young)!.alive) {
      expect(w.fidelity.get(young)).toBe('full');
      expect(w.homeSettlement.get(young)).toBe(w.focusedSettlementId);
    }
  });

  it('rule passes to a real local heir in the focused settlement (an actor can rise to rule)', () => {
    const w = createWorld(2024);
    runYears(w, 70); // long enough for at least one succession
    const rulerId = w.settlements[w.focusedSettlementId].currentRulerId!;
    expect(w.identity.has(rulerId)).toBe(true); // a simulated actor, not a minted stranger
    expect(w.figures.some((f) => f.id === rulerId && f.role === 'ruler')).toBe(true);
  });
});
