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
import { resolvePlayerIntent } from '../systems/resolve';
import { fullActors, summaryActors, createActor } from './world';
import { ageCompatible } from './aspiration';
import { addThought, computeOpinion, opinionReasons } from './opinion';
import { interestOf } from './chronicle';
import { expand, type GrammarRules } from './grammar';
import { Rng } from './rng';
import { BASE_PRICE, maturityOf, elderhoodOf, fertileWindowOf, professionIncomeOf, ambitionOf, unionViable, canBear } from '../content/fixture';
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
    expect(snap.settlements.length).toBe(10);
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
  it('specialization drives prices: farmers have cheaper food than miners', () => {
    const w = createWorld(42);
    runYears(w, 30);
    const avgFoodPrice = (spec: string) => {
      const ss = w.settlements.filter(
        (s) => s.econ.specialization === spec && !s.detailed && s.macro.population > 0,
      );
      return ss.length ? ss.reduce((a, s) => a + s.econ.price.food, 0) / ss.length : null;
    };
    const farm = avgFoodPrice('farming');
    const mine = avgFoodPrice('mining');
    expect(farm).not.toBeNull();
    expect(mine).not.toBeNull();
    expect(farm!).toBeLessThan(mine!); // surplus → cheap, deficit → dear

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
    // a surviving settlement has had multiple rulers across history
    const longLived = w.settlements.find((s) => s.ruinedYear === undefined && s.macro.population > 0)!;
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
    for (const seed of [1492, 7, 42, 99, 2024]) {
      const w2 = createWorld(seed, false);
      runYears(w2, 600);
      for (const e of w2.events) {
        if (e.type === 'ruined') {
          sawRuin = true;
          expect(e.subjects.length).toBe(1); // its last ruler
        }
      }
    }
    expect(sawRuin).toBe(true);
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
    for (const g of groks) expect(w.ties.get(g)?.spouse).toBeUndefined();
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
