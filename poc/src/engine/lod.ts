/**
 * Level-of-Detail layer with THREE fidelity tiers, plus migration.
 *
 *   full     — per-actor simulation; resides in the focused settlement.
 *   summary  — a named individual tracked world-wide; resides elsewhere; aged and
 *              killed coarsely (yearly), keeps identity + relationships across
 *              focus changes. This is what makes cross-settlement relationships and
 *              "the person you met is still there when you return" possible.
 *   aggregate— the anonymous mass; no entity at all, just MacroPop rates.
 *
 * INVARIANT: full actors live in the focused settlement; summary actors live in
 * every OTHER settlement. Focusing a settlement upgrades its resident summaries to
 * full; leaving it demotes a few notables to summaries and frees the rest.
 *
 * Determinism: each settlement owns an independent RNG stream; the focused stream
 * is world.rng. Summary aging + migration use world.rng (a deliberate
 * simplification — they are driven by the player's attention/tick order).
 */
import {
  type World,
  type Settlement,
  type MacroPop,
  type RegionEdge,
  type Economy,
  type ResourceKey,
  type EntityId,
  RESOURCE_KEYS,
  ADULT_AGE,
  ELDER_AGE,
  DAYS_PER_YEAR,
} from './model';
import { Rng, mixSeed } from './rng';
import {
  fullActors,
  summaryActors,
  createActor,
  getRel,
  emit,
  relCount,
  removeActorCompletely,
  clamp,
} from './world';
import { addThought } from './opinion';
import { mintFigure } from './figures';
import {
  SPECIES,
  speciesById,
  generateGiven,
  generateFamily,
  pickSex,
  pickTraits,
  pickProfession,
  pickSpecialization,
  PRODUCTION,
  CONSUMPTION,
  BASE_PRICE,
} from '../content/fixture';
import { deathProbability } from '../systems/lifecycle';

const SETTLEMENT_COUNT = 10;
const MAX_SUMMARIES_PER_SETTLEMENT = 6;
const NAME_A = ['Stone', 'Ash', 'Oak', 'Fen', 'Briar', 'Grey', 'Wend', 'Mire', 'Hollow', 'Black', 'Rill', 'Thorn'];
const NAME_B = ['reach', 'ford', 'hollow', 'mere', 'barrow', 'gate', 'wick', 'fell', 'haven', 'crest', 'moor', 'bury'];

// ----------------------------------------------------------- worldgen --------

export function createSettlements(world: World): void {
  const gen = new Rng(mixSeed(world.seed, 0x5e77));
  const used = new Set<string>();
  for (let i = 0; i < SETTLEMENT_COUNT; i++) {
    let name = NAME_A[gen.int(NAME_A.length)] + NAME_B[gen.int(NAME_B.length)];
    while (used.has(name)) name = NAME_A[gen.int(NAME_A.length)] + NAME_B[gen.int(NAME_B.length)];
    used.add(name);

    const dominant = SPECIES[gen.int(SPECIES.length)].id;
    const pop = gen.range(80, 320);
    const macro = freshBands(pop, dominant, gen);
    macro.stability = gen.range(-10, 50);

    const s: Settlement = {
      id: i,
      name,
      pos: { x: gen.range(6, 94), y: gen.range(6, 94) },
      foundedYear: 0,
      detailed: false,
      epoch: 0,
      rngState: mixSeed(world.seed, i + 1),
      macro,
      econ: initEconomy(gen, pop),
    };
    world.settlements.push(s);
    // mint the founder (also the first ruler) so the founding has a named person
    const founder = mintFigure(world, s, 0, gen, 'founder');
    s.currentRulerId = founder.id;
    emit(world, 'settlement_founded', [founder.id], { name: s.name, population: pop });
  }

  buildRegionGraph(world, gen);
  world.geoRngState = mixSeed(world.seed, 0x6e0);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Build a connected proximity graph: each settlement links to its nearest
 *  neighbours (trade routes), then any disconnected components are joined. */
function buildRegionGraph(world: World, gen: Rng): void {
  const ss = world.settlements;
  const K = 3;
  const have = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const addEdge = (a: number, b: number) => {
    if (a === b || have.has(key(a, b))) return;
    have.add(key(a, b));
    world.edges.push({
      a: Math.min(a, b),
      b: Math.max(a, b),
      distance: dist(ss[a].pos, ss[b].pos),
      relation: gen.range(-15, 15),
      tradeVolume: 0,
    });
  };

  for (let i = 0; i < ss.length; i++) {
    const order = ss
      .map((s, j) => ({ j, d: dist(ss[i].pos, s.pos) }))
      .filter((o) => o.j !== i)
      .sort((p, q) => p.d - q.d);
    for (let k = 0; k < K && k < order.length; k++) addEdge(i, order[k].j);
  }

  // union-find connectivity: link nearest cross-component pairs until connected
  const n = ss.length;
  const parent = [...Array(n).keys()];
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (const e of world.edges) union(e.a, e.b);
  for (let guard = 0; guard < n; guard++) {
    const roots = new Set([...Array(n).keys()].map(find));
    if (roots.size <= 1) break;
    let best: { i: number; j: number; d: number } | null = null;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (find(i) !== find(j)) {
          const d = dist(ss[i].pos, ss[j].pos);
          if (!best || d < best.d) best = { i, j, d };
        }
    if (!best) break;
    addEdge(best.i, best.j);
    union(best.i, best.j);
  }
}

function edgeBetween(world: World, a: number, b: number): RegionEdge | undefined {
  for (const e of world.edges) if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
  return undefined;
}

function freshBands(pop: number, dominant: string, rng: Rng): MacroPop {
  const children = Math.round(pop * (0.26 + rng.next() * 0.08));
  const elders = Math.round(pop * (0.12 + rng.next() * 0.06));
  const adults = Math.max(0, pop - children - elders);
  return { population: pop, children, adults, elders, stability: 0, dominantSpecies: dominant };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function computePrices(e: Economy, pop: number): void {
  for (const r of RESOURCE_KEYS) {
    const desired = CONSUMPTION[r] * pop * 2; // a 2-year buffer is "fair value"
    e.price[r] = round2(BASE_PRICE[r] * clamp(desired / (e.stock[r] + 1), 0.4, 3.5));
  }
}

function initEconomy(gen: Rng, pop: number): Economy {
  const specialization = pickSpecialization(gen);
  const stock = {} as Record<ResourceKey, number>;
  for (const r of RESOURCE_KEYS) stock[r] = Math.round(CONSUMPTION[r] * pop * (1.2 + gen.next() * 0.8));
  const econ: Economy = { specialization, stock, price: { food: 0, materials: 0, goods: 0 }, wealth: gen.range(50, 400) };
  computePrices(econ, pop);
  return econ;
}

// --------------------------------------------------- promote / demote --------

const BAND_RANGE: Array<[number, number]> = [
  [0, ADULT_AGE - 1],
  [ADULT_AGE, ELDER_AGE - 1],
  [ELDER_AGE, Math.round(ELDER_AGE * 1.6)],
];

/** Materialize a settlement into full actors. Caller must have set
 *  world.focusedSettlementId = s.id and pointed world.rng at s's stream. */
export function promote(world: World, s: Settlement): void {
  s.detailed = true;
  const rng = world.rng;
  const m = s.macro;

  // 1) upgrade resident summary actors back to full (identity + relations intact)
  const residents = summaryActors(world).filter((id) => world.homeSettlement.get(id) === s.id);
  for (const id of residents) world.fidelity.set(id, 'full');

  // 2) fill the remaining headcount with fresh anonymous actors, by age band
  const made: EntityId[] = [...residents];
  const remaining = Math.max(0, m.population - made.length);
  const bandW = [Math.max(0, m.children), Math.max(0, m.adults), Math.max(0, m.elders)];
  const weights = bandW.some((w) => w > 0) ? bandW : [1, 1, 1];
  for (let i = 0; i < remaining; i++) {
    const [lo, hi] = BAND_RANGE[rng.weightedIndex(weights)];
    const species = rng.chance(0.7) ? m.dominantSpecies : SPECIES[rng.int(SPECIES.length)].id;
    made.push(
      createActor(world, {
        given: generateGiven(rng, species),
        family: generateFamily(rng),
        sex: pickSex(rng),
        speciesId: species,
        profession: pickProfession(rng),
        traits: pickTraits(rng),
        ageYears: clamp(rng.range(lo, hi), 0, hi),
      }),
    );
  }

  // 3) seed marriages among the unmarried adults
  seedMarriages(world, made, rng);
}

function seedMarriages(world: World, ids: EntityId[], rng: Rng): void {
  const males: EntityId[] = [];
  const females: EntityId[] = [];
  for (const id of ids) {
    if (world.lifecycle.get(id)!.ageYears < ADULT_AGE) continue;
    if (world.ties.get(id)!.spouse !== undefined) continue;
    (world.identity.get(id)!.sex === 'm' ? males : females).push(id);
  }
  const pairs = Math.min(males.length, females.length);
  for (let i = 0; i < pairs; i++) {
    if (!rng.chance(0.45)) continue;
    const m = males[i];
    const f = females[i];
    world.ties.get(m)!.spouse = f;
    world.ties.get(f)!.spouse = m;
    const edge = getRel(world, m, f);
    addThought(edge, 'wed', world.tick);
    edge.flags.spouse = true;
    edge.flags.friend = true;
  }
}

/** Fold the focused settlement back into aggregate state: keep a few notables as
 *  persistent summary actors, free the anonymous rest. */
export function demote(world: World, s: Settlement): void {
  const full = fullActors(world); // these are s's actors (s is currently focused)

  let children = 0;
  let adults = 0;
  let elders = 0;
  const tally = new Map<string, number>();
  for (const id of full) {
    const age = world.lifecycle.get(id)!.ageYears;
    if (age < ADULT_AGE) children++;
    else if (age < ELDER_AGE) adults++;
    else elders++;
    const sp = world.identity.get(id)!.speciesId;
    tally.set(sp, (tally.get(sp) ?? 0) + 1);
  }
  let dominant = s.macro.dominantSpecies;
  let best = -1;
  for (const [sp, c] of tally) if (c > best) { best = c; dominant = sp; }
  s.macro = { population: full.length, children, adults, elders, stability: s.macro.stability, dominantSpecies: dominant };

  // Survivors become persistent summary actors — capped so the summary tier stays
  // bounded. Prioritize anyone with a cross-settlement tie (so those relationships
  // survive), then fill the remaining slots with the most-connected locals.
  const byConnections = [...full].sort((a, b) => relCount(world, b) - relCount(world, a));
  const survivors = new Set<EntityId>();
  for (const id of byConnections) {
    if (survivors.size >= MAX_SUMMARIES_PER_SETTLEMENT) break;
    if (hasCrossTie(world, id, s.id)) survivors.add(id);
  }
  for (const id of byConnections) {
    if (survivors.size >= MAX_SUMMARIES_PER_SETTLEMENT) break;
    survivors.add(id);
  }

  for (const id of survivors) {
    world.fidelity.set(id, 'summary');
    world.homeSettlement.set(id, s.id);
  }
  for (const id of full) if (!survivors.has(id)) removeActorCompletely(world, id);

  s.rngState = world.rng.state;
  s.detailed = false;
  s.epoch += 1;
}

/** Does this actor have a relationship to someone living in another settlement? */
function hasCrossTie(world: World, id: EntityId, homeId: number): boolean {
  for (const partner of world.rels.get(id)!.keys()) {
    const ph = world.homeSettlement.get(partner);
    if (ph !== undefined && ph !== homeId) return true;
  }
  return false;
}

export function focusSettlement(world: World, targetId: number): void {
  if (targetId === world.focusedSettlementId) return;
  if (targetId < 0 || targetId >= world.settlements.length) return;

  const target = world.settlements[targetId];

  // demote the current settlement — unless we're coming from headless / worldgen
  // (no settlement focused), which is the player-enters-the-world handoff.
  const hadFocus = world.focusedSettlementId >= 0;
  const fromName = hadFocus ? world.settlements[world.focusedSettlementId].name : undefined;
  if (hadFocus) demote(world, world.settlements[world.focusedSettlementId]);

  world.rng.state = target.rngState; // activate target's own stream
  world.focusedSettlementId = targetId; // set BEFORE promote so new actors home correctly
  promote(world, target);

  // a focus-shift is only "news" when attention moved between two settlements
  if (hadFocus) {
    emit(world, 'focus_shift', [], { from: fromName!, to: target.name, population: target.macro.population });
  }
}

// --------------------------------------------------- aggregate macro ---------

export function macroYearly(world: World): void {
  for (const s of world.settlements) {
    if (s.detailed) continue;
    const rng = new Rng(s.rngState);
    stepMacro(world, s, rng);
    s.rngState = rng.state;
  }
}

function stepMacro(world: World, s: Settlement, rng: Rng): void {
  const m = s.macro;
  if (m.population <= 0) return;
  const before = m.population;

  const matured = Math.round(m.children / ADULT_AGE);
  const aged = Math.round(m.adults / (ELDER_AGE - ADULT_AGE));
  m.children = Math.max(0, m.children - matured);
  m.adults = Math.max(0, m.adults + matured - aged);
  m.elders += aged;

  // mean-reverting stability prevents getting stuck in a death-spiral
  m.stability = clamp(Math.round(m.stability * 0.9) + rng.range(-6, 6), -100, 100);

  // Logistic growth: a settlement breeds fast when there's room (so it RECOVERS
  // from shocks instead of spiralling to ruin) and tapers toward a soft carrying
  // capacity. This is what keeps a world sustainable over many centuries.
  const CAPACITY = 260;
  const room = Math.max(0, 1 - m.population / CAPACITY);
  const births = Math.max(0, Math.round(m.adults * (0.022 + 0.05 * room) * (1 + m.stability / 300)));
  m.children += births;

  let deaths = Math.round(m.children * 0.004 + m.adults * 0.008 + m.elders * 0.06);
  if (rng.chance(0.05)) {
    const toll = rng.range(3, 14) + Math.round(Math.max(0, -m.stability) / 12);
    deaths += toll;
    m.stability = clamp(m.stability - rng.range(3, 8), -100, 100);
    emit(world, 'hardship', [], { name: s.name, toll });
  } else if (rng.chance(0.06)) {
    m.stability = clamp(m.stability + rng.range(3, 9), -100, 100);
    if (m.stability > 30) emit(world, 'prosperity', [], { name: s.name, population: m.population });
  }

  applyDeaths(m, deaths);
  m.population = m.children + m.adults + m.elders;

  if (Math.floor(m.population / 100) > Math.floor(before / 100) && m.population > before) {
    emit(world, 'milestone', [], { name: s.name, population: Math.floor(m.population / 100) * 100 });
  }
}

function applyDeaths(m: MacroPop, deaths: number): void {
  let d = deaths;
  const fromElders = Math.min(m.elders, Math.round(d * 0.7));
  m.elders -= fromElders;
  d -= fromElders;
  const fromAdults = Math.min(m.adults, Math.round(d * 0.8));
  m.adults -= fromAdults;
  d -= fromAdults;
  m.children -= Math.min(m.children, d);
}

// --------------------------------------------------------- geography ---------

/**
 * Inter-settlement geography, yearly. Along each graph edge, relations drift;
 * friendly+near pairs TRADE (mutual stability, building trust → trade routes);
 * hostile pairs RAID (the weaker aggregate side loses people → frontiers). The
 * focused settlement never takes aggregate damage (it can only be the raider).
 * Uses a dedicated RNG stream so geography is independent of which settlement the
 * player is looking at.
 */
export function geographyYearly(world: World): void {
  const rng = new Rng(world.geoRngState);
  for (const e of world.edges) {
    const A = world.settlements[e.a];
    const B = world.settlements[e.b];
    const proximity = 1 / (1 + e.distance / 25); // 0..1, nearer => stronger ties

    // mean-reverting relation drift (trade nudges it back up in economyYearly)
    e.relation = clamp(Math.round(e.relation * 0.96) + rng.range(-5, 5), -100, 100);
    // a rare border grievance sharply sours relations — the seed of raids & wars
    if (rng.chance(0.012)) e.relation = clamp(e.relation - rng.range(18, 44), -100, 100);

    if (
      e.relation < -40 &&
      !A.detailed &&
      !B.detailed &&
      A.ruinedYear === undefined &&
      B.ruinedYear === undefined &&
      A.macro.population > 25 &&
      B.macro.population > 25 &&
      rng.chance(0.05 + proximity * 0.06)
    ) {
      // open WAR between two hostile, populated neighbours
      const strong = A.macro.population >= B.macro.population ? A : B;
      const weak = strong === A ? B : A;
      e.relation = clamp(e.relation - rng.range(4, 10), -100, 100);
      e.tradeVolume = 0;
      if (strong.macro.population > weak.macro.population * 1.4 && rng.chance(0.7)) {
        // a decisive CONQUEST — the weaker is razed to ruin under the victor's ruler
        weak.macro = { ...weak.macro, population: 0, children: 0, adults: 0, elders: 0 };
        weak.ruinedYear = Math.floor(world.tick / DAYS_PER_YEAR);
        strong.macro.stability = clamp(strong.macro.stability - rng.range(2, 6), -100, 100);
        const subjects = strong.currentRulerId !== undefined ? [strong.currentRulerId] : [];
        emit(world, 'conquest', subjects, { victor: strong.name, fallen: weak.name });
      } else {
        // an inconclusive BATTLE — both sides bleed, named by their rulers
        const aToll = Math.round(rng.range(6, 20) * proximity);
        const bToll = Math.round(rng.range(6, 20) * proximity);
        raidMacro(A.macro, aToll);
        A.macro.population = A.macro.children + A.macro.adults + A.macro.elders;
        raidMacro(B.macro, bToll);
        B.macro.population = B.macro.children + B.macro.adults + B.macro.elders;
        A.macro.stability = clamp(A.macro.stability - rng.range(3, 8), -100, 100);
        B.macro.stability = clamp(B.macro.stability - rng.range(3, 8), -100, 100);
        const subjects = [A.currentRulerId, B.currentRulerId].filter((x): x is number => x !== undefined);
        emit(world, 'battle', subjects, { a: A.name, b: B.name, aToll, bToll });
      }
    } else if (e.relation < -25 && rng.chance(0.022 + proximity * 0.03)) {
      // a raid along a hostile border. The weaker, non-focused side is the victim;
      // the focused settlement is treated as strongest and never takes macro damage.
      const popA = A.detailed ? Infinity : A.macro.population;
      const popB = B.detailed ? Infinity : B.macro.population;
      const victim = popA <= popB ? A : B;
      const raider = victim === A ? B : A;
      e.relation = clamp(e.relation - rng.range(3, 9), -100, 100);
      let toll = 0;
      if (!victim.detailed) {
        toll = Math.max(1, Math.round(proximity * rng.range(3, 11)));
        raidMacro(victim.macro, toll);
        victim.macro.population = victim.macro.children + victim.macro.adults + victim.macro.elders;
        victim.macro.stability = clamp(victim.macro.stability - rng.range(4, 12), -100, 100);
      }
      e.tradeVolume *= 0.4; // war chokes the route
      emit(world, 'raid', [], { raider: raider.name, victim: victim.name, toll });
    }
  }
  world.geoRngState = rng.state;
}

function raidMacro(m: MacroPop, toll: number): void {
  let d = toll;
  const a = Math.min(m.adults, Math.round(d * 0.6));
  m.adults -= a;
  d -= a;
  const el = Math.min(m.elders, Math.round(d * 0.5));
  m.elders -= el;
  d -= el;
  m.children -= Math.min(m.children, d);
}

// ----------------------------------------------------------- economy ---------

/**
 * The economy, yearly (deterministic, no RNG). Each settlement produces and
 * consumes resources by its specialization, so surpluses & deficits set local
 * prices. Goods then flow along non-hostile edges from cheap (surplus) to dear
 * (scarce), equalizing prices, building wealth and trust. Towns that run out of
 * food suffer famine; well-fed, wealthy towns gain stability. The trade routes
 * built by geography are the substrate; goods are the layer on top.
 */
export function economyYearly(world: World): void {
  const fullCount = fullActors(world).length;
  const popOf = (s: Settlement) => (s.detailed ? fullCount : s.macro.population);

  // 1) produce & consume -> stocks; earn/decay wealth; set prices
  for (const s of world.settlements) {
    const pop = popOf(s);
    if (pop <= 0) continue;
    const e = s.econ;
    for (const r of RESOURCE_KEYS) {
      const prod = PRODUCTION[e.specialization][r] * pop;
      const cons = CONSUMPTION[r] * pop;
      e.stock[r] = Math.max(0, e.stock[r] + prod - cons);
    }
    e.wealth = Math.max(0, e.wealth * 0.96 + PRODUCTION[e.specialization].goods * pop * BASE_PRICE.goods * 0.03);
    computePrices(e, pop);
  }

  // 2) trade goods along non-hostile edges (price equalization + wealth + trust)
  let busiest = { value: 0, from: '', to: '' };
  for (const edge of world.edges) {
    const A = world.settlements[edge.a];
    const B = world.settlements[edge.b];
    if (edge.relation <= -25) {
      edge.tradeVolume *= 0.6; // actively hostile — the route is closed
      continue;
    }
    const popA = popOf(A);
    const popB = popOf(B);
    if (popA <= 0 || popB <= 0) {
      edge.tradeVolume *= 0.7;
      continue;
    }
    const proximity = 1 / (1 + edge.distance / 30);
    const relFactor = clamp((edge.relation + 30) / 100, 0.15, 1);

    let value = 0;
    for (const r of RESOURCE_KEYS) {
      const seller = A.econ.price[r] <= B.econ.price[r] ? A : B;
      const buyer = seller === A ? B : A;
      const gap = buyer.econ.price[r] - seller.econ.price[r];
      if (gap < 0.4) continue;
      // goods stocks are continuous, so trade can be fractional — don't floor it
      // away on cold/distant routes (that silently killed trade for some seeds).
      const qty = Math.min(seller.econ.stock[r] * 0.3, gap * 9) * proximity * relFactor;
      if (qty <= 0.01) continue;
      seller.econ.stock[r] -= qty;
      buyer.econ.stock[r] += qty;
      const tradePrice = (A.econ.price[r] + B.econ.price[r]) / 2;
      const v = tradePrice * qty;
      seller.econ.wealth += v * 0.5;
      buyer.econ.wealth += v * 0.3; // both gain from trade
      value += v;
    }
    // re-price so later edges see the updated scarcity this year
    computePrices(A.econ, popA);
    computePrices(B.econ, popB);

    edge.tradeVolume = edge.tradeVolume * 0.8 + value * 0.05;
    if (value > 0) {
      edge.relation = clamp(edge.relation + 1, -100, 100); // trade builds trust
      if (value > busiest.value) busiest = { value, from: A.name, to: B.name };
    }
  }
  // one event per year for the busiest route — keeps the feed informative, not noisy
  if (busiest.value > 12) {
    emit(world, 'trade', [], { from: busiest.from, to: busiest.to, goods: Math.round(busiest.value) });
  }

  // 3) food security: famine where the granaries ran dry; plenty lifts stability
  for (const s of world.settlements) {
    const pop = popOf(s);
    if (pop <= 0) continue;
    const foodYears = s.econ.stock.food / pop;
    if (s.detailed) continue; // focused town's deaths come from its full-fidelity sim
    if (foodYears < 0.5) {
      const toll = Math.round((0.5 - foodYears) * pop * 0.4);
      if (toll > 0) {
        raidMacro(s.macro, toll);
        s.macro.population = s.macro.children + s.macro.adults + s.macro.elders;
        s.macro.stability = clamp(s.macro.stability - 8, -100, 100);
        emit(world, 'famine', [], { name: s.name, toll });
      }
    } else if (foodYears > 1.6) {
      s.macro.stability = clamp(s.macro.stability + 1, -100, 100);
    }
    if (s.econ.wealth > 600) s.macro.stability = clamp(s.macro.stability + 1, -100, 100);
  }
}

// ------------------------------------------------ summary tier + migration ---

/** Coarse yearly simulation of summary actors (named people living elsewhere). */
export function summaryYearly(world: World): void {
  const rng = world.rng;
  for (const id of summaryActors(world)) {
    const lc = world.lifecycle.get(id)!;
    lc.ageYears += 1;
    const sp = speciesById(world.identity.get(id)!.speciesId);
    if (rng.chance(deathProbability(lc.ageYears, sp.lifespan))) {
      const home = world.homeSettlement.get(id)!;
      lc.alive = false;
      lc.deathTick = world.tick;
      const deathId = emit(world, 'died', [id], { age: lc.ageYears, settlement: world.settlements[home].name });
      const spouse = world.ties.get(id)!.spouse;
      if (spouse !== undefined && world.lifecycle.get(spouse)?.alive) {
        emit(world, 'widowed', [spouse], {}, [deathId]);
      }
      const macro = world.settlements[home].macro;
      macro.population = Math.max(0, macro.population - 1);
      removeActorCompletely(world, id);
    }
  }
}

/** Pick where an emigrant goes: nearby and friendly settlements are far more
 *  likely than distant or hostile ones — migration follows geography. */
function pickMigrationTarget(world: World, focusedId: number, rng: Rng): number {
  const focused = world.settlements[focusedId];
  const weights = world.settlements.map((s) => {
    if (s.id === focusedId) return 0;
    const d = dist(focused.pos, s.pos);
    const e = edgeBetween(world, focusedId, s.id);
    const rel = e ? e.relation : 0;
    const proximity = 1 / (1 + d / 15);
    const relFactor = clamp(1 + rel / 80, 0.25, 2.2);
    return proximity * relFactor;
  });
  return rng.weightedIndex(weights);
}

/** Named people move between the focused settlement and the rest of the world,
 *  carrying their relationships with them (creating cross-settlement ties). */
export function migrationYearly(world: World): void {
  if (world.focusedSettlementId < 0) return; // no focused town to move people in/out of
  const rng = world.rng;
  const focusedId = world.focusedSettlementId;

  // EMIGRATION: a few adults leave the focused settlement to live elsewhere.
  // The player is never moved involuntarily — leaving is their choice (travel).
  const leavers = fullActors(world).filter(
    (id) => id !== world.playerId && world.lifecycle.get(id)!.ageYears >= ADULT_AGE,
  );
  const emigrants = Math.min(rng.int(3), leavers.length); // 0..2
  for (let i = 0; i < emigrants; i++) {
    const id = leavers[rng.int(leavers.length)];
    if (world.fidelity.get(id) !== 'full') continue; // already moved this pass
    const target = pickMigrationTarget(world, focusedId, rng); // near + friendly preferred
    world.fidelity.set(id, 'summary');
    world.homeSettlement.set(id, target);
    world.settlements[target].macro.population += 1;
    emit(world, 'emigrated', [id], { from: world.settlements[focusedId].name, to: world.settlements[target].name });
  }

  // IMMIGRATION: a few named people from elsewhere settle in the focused town
  const incomers = summaryActors(world).filter((id) => world.homeSettlement.get(id) !== focusedId);
  const immigrants = Math.min(rng.int(3), incomers.length); // 0..2
  const moved = new Set<EntityId>();
  for (let i = 0; i < immigrants; i++) {
    const id = incomers[rng.int(incomers.length)];
    if (moved.has(id)) continue;
    moved.add(id);
    const fromId = world.homeSettlement.get(id)!;
    const fromMacro = world.settlements[fromId].macro;
    fromMacro.population = Math.max(0, fromMacro.population - 1);
    world.fidelity.set(id, 'full');
    world.homeSettlement.set(id, focusedId);
    emit(world, 'immigrated', [id], { from: world.settlements[fromId].name, to: world.settlements[focusedId].name });
  }
}
