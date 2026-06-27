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
  type EntityId,
  DAYS_PER_YEAR,
} from './model';
import { Rng, mixSeed } from './rng';
import { type Geography, siteSuitability, isLand, terrainCapacity } from './geography';
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
  macroFertilityOf,
  generateGiven,
  generateFamily,
  pickSex,
  pickTraits,
  pickProfession,
  terrainYields,
  specializationFromTerrain,
  maturityOf,
  elderhoodOf,
  pairBondsFor,
  unionViable,
  pickGovernment,
  hasLeader,
  pickCulture,
  culturalDistance,
  mostOpposedValue,
  RESOURCES,
  SUBSISTENCE_RESOURCE,
  PREMIUM_RESOURCE,
  SUBSISTENCE_NEED,
  CONSUMPTION,
  BASE_PRICE,
} from '../content/fixture';
import { deathProbability } from '../systems/lifecycle';

const SETTLEMENT_COUNT = 10;
const MAX_SUMMARIES_PER_SETTLEMENT = 6;
/** The humanlike lifespan the aggregate mortality baselines were tuned against;
 *  a species' attrition is scaled by REF_LIFESPAN / its own lifespan, so longer-
 *  lived peoples die more slowly in aggregate (matching their slower maturation). */
const REF_LIFESPAN = 72;
const NAME_A = ['Stone', 'Ash', 'Oak', 'Fen', 'Briar', 'Grey', 'Wend', 'Mire', 'Hollow', 'Black', 'Rill', 'Thorn'];
const NAME_B = ['reach', 'ford', 'hollow', 'mere', 'barrow', 'gate', 'wick', 'fell', 'haven', 'crest', 'moor', 'bury'];

// ----------------------------------------------------------- worldgen --------

export function createSettlements(world: World): void {
  const gen = new Rng(mixSeed(world.seed, 0x5e77));
  const geo = world.geography;

  // 1) WHERE to found — geography decides. Score many random land sites by suitability
  //    (fresh water, fertile soil, coast, defensible ground) and greedily pick the best
  //    that are well-spaced, so towns cluster on good land near water, not in voids.
  const cands: { x: number; y: number; score: number }[] = [];
  for (let t = 0; t < 600; t++) {
    const x = 3 + gen.next() * 94;
    const y = 3 + gen.next() * 94;
    const score = siteSuitability(geo, x, y);
    if (score > 0.4) cands.push({ x, y, score });
  }
  cands.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
  const sites: { x: number; y: number; score: number }[] = [];
  for (const c of cands) {
    if (sites.length >= SETTLEMENT_COUNT) break;
    if (sites.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= 13)) sites.push(c);
  }
  // relax spacing where good land is scarce, then fall back to any land
  for (let relax = 10; sites.length < SETTLEMENT_COUNT && relax >= 0; relax -= 2) {
    for (const c of cands) {
      if (sites.length >= SETTLEMENT_COUNT) break;
      if (sites.includes(c)) continue;
      if (sites.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= relax)) sites.push(c);
    }
  }
  for (let guard = 0; sites.length < SETTLEMENT_COUNT && guard < 4000; guard++) {
    const x = 3 + gen.next() * 94;
    const y = 3 + gen.next() * 94;
    if (isLand(geo, x, y)) sites.push({ x, y, score: 0 });
  }

  // 2) FOUND a settlement at each site — the more generous the land, the larger the founding.
  const used = new Set<string>();
  for (let i = 0; i < SETTLEMENT_COUNT; i++) {
    const site = sites[i];
    let name = NAME_A[gen.int(NAME_A.length)] + NAME_B[gen.int(NAME_B.length)];
    while (used.has(name)) name = NAME_A[gen.int(NAME_A.length)] + NAME_B[gen.int(NAME_B.length)];
    used.add(name);

    const dominant = SPECIES[gen.int(SPECIES.length)].id;
    const pop = Math.round(clamp(60 + site.score * 26 + gen.next() * 40, 40, 340));
    const macro = freshBands(pop, dominant, gen);
    macro.stability = gen.range(-10, 50);

    const s: Settlement = {
      id: i,
      name,
      pos: { x: site.x, y: site.y },
      foundedYear: 0,
      detailed: false,
      epoch: 0,
      rngState: mixSeed(world.seed, i + 1),
      governmentId: pickGovernment(gen),
      cultureId: pickCulture(gen, dominant),
      capacity: terrainCapacity(geo, site.x, site.y),
      macro,
      econ: initEconomy(gen, pop, geo, site.x, site.y),
    };
    world.settlements.push(s);
    // mint the founder so the founding has a named person. In a polity with a leader
    // the founder is also its first ruler; a leaderless polity records the founder in
    // history but has no ongoing ruler.
    const founder = mintFigure(world, s, 0, gen, 'founder');
    if (hasLeader(s.governmentId)) s.currentRulerId = founder.id;
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
  for (const r of RESOURCES) {
    const desired = CONSUMPTION[r] * pop * 2; // a 2-year buffer is "fair value"
    e.price[r] = round2(BASE_PRICE[r] * clamp(desired / (e.stock[r] + 1), 0.4, 3.5));
  }
}

function initEconomy(gen: Rng, pop: number, geo: Geography, x: number, y: number): Economy {
  // production and trade come from the LAND, not a random roll
  const production = terrainYields(geo, x, y);
  const specialization = specializationFromTerrain(geo, x, y);
  const stock: Record<string, number> = {};
  const price: Record<string, number> = {};
  for (const r of RESOURCES) {
    stock[r] = Math.round(CONSUMPTION[r] * pop * (1.2 + gen.next() * 0.8));
    price[r] = 0;
  }
  const econ: Economy = { specialization, production, stock, price, wealth: gen.range(50, 400) };
  computePrices(econ, pop);
  return econ;
}

// --------------------------------------------------- promote / demote --------

/** Age ranges for the three demographic bands [children, adults, elders] of a
 *  given species, derived from ITS maturity/elderhood — so materializing an
 *  aggregate of long-lived people yields plausibly older actors than a short-lived
 *  one. */
function bandRanges(speciesId: string): Array<[number, number]> {
  const mat = maturityOf(speciesId);
  const eld = elderhoodOf(speciesId);
  return [
    [0, mat - 1],
    [mat, eld - 1],
    [eld, Math.round(eld * 1.6)],
  ];
}

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
    const species = rng.chance(0.7) ? m.dominantSpecies : SPECIES[rng.int(SPECIES.length)].id;
    const [lo, hi] = bandRanges(species)[rng.weightedIndex(weights)];
    made.push(
      createActor(world, {
        given: generateGiven(rng, species),
        family: generateFamily(rng),
        sex: pickSex(rng, species),
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
  // eligible: adult, unmarried, from a PAIR-BONDING species (asexual ones never wed).
  const ageOf = (id: EntityId) => world.lifecycle.get(id)!.ageYears;
  const elig = ids.filter((id) => {
    const idn = world.identity.get(id)!;
    if (!pairBondsFor(idn.speciesId)) return false;
    if (ageOf(id) < maturityOf(idn.speciesId)) return false;
    return world.ties.get(id)!.spouse === undefined;
  });
  // pair by age proximity: sort once, then each unmarried person takes the nearest-age
  // viable partner ahead of them. Generic over sexes/modes — no male/female buckets.
  elig.sort((x, y) => ageOf(x) - ageOf(y) || x - y);
  const taken = new Set<EntityId>();
  for (let i = 0; i < elig.length; i++) {
    const a = elig[i];
    if (taken.has(a)) continue;
    if (!rng.chance(0.45)) continue;
    const ia = world.identity.get(a)!;
    for (let j = i + 1; j < elig.length; j++) {
      const b = elig[j];
      if (taken.has(b)) continue;
      if (Math.abs(ageOf(a) - ageOf(b)) > 16) break; // sorted by age: nothing closer ahead
      const ib = world.identity.get(b)!;
      if (!unionViable(ia.speciesId, ia.sex, ib.speciesId, ib.sex)) continue;
      taken.add(a);
      taken.add(b);
      world.ties.get(a)!.spouse = b;
      world.ties.get(b)!.spouse = a;
      const edge = getRel(world, a, b);
      addThought(edge, 'wed', world.tick);
      edge.flags.spouse = true;
      edge.flags.friend = true;
      break;
    }
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
    const sp = world.identity.get(id)!.speciesId;
    if (age < maturityOf(sp)) children++;
    else if (age < elderhoodOf(sp)) adults++;
    else elders++;
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

  const mat = maturityOf(m.dominantSpecies);
  const eld = elderhoodOf(m.dominantSpecies);
  const matured = Math.round(m.children / mat);
  const aged = Math.round(m.adults / (eld - mat));
  m.children = Math.max(0, m.children - matured);
  m.adults = Math.max(0, m.adults + matured - aged);
  m.elders += aged;

  // Viability floor: below a critical mass a community can no longer sustain itself —
  // the last families disperse and the place falls to ruin. This is the world's SLOW
  // decline death, distinct from conquest: geography makes it likeliest for the small,
  // marginal sites that famine, plague or raids have already gutted. Without it, the
  // logistic recovery below would let every settlement bounce back forever (no falls).
  if (m.population < 15) {
    applyDeaths(m, Math.max(2, Math.round(m.population * 0.4))); // the last people drain away
    m.population = m.children + m.adults + m.elders;
    return; // no recovery below the floor
  }

  // mean-reverting stability prevents getting stuck in a death-spiral
  m.stability = clamp(Math.round(m.stability * 0.9) + rng.range(-6, 6), -100, 100);

  // Logistic growth: a settlement breeds fast when there's room (so it RECOVERS
  // from shocks instead of spiralling to ruin) and tapers toward a soft carrying
  // capacity. This is what keeps a world sustainable over many centuries.
  // carrying capacity is set by the LAND: fertile, watered, coastal sites grow great
  // cities; barren, dry, isolated ones stay villages.
  const CAPACITY = 260 * s.capacity;
  const room = Math.max(0, 1 - m.population / CAPACITY);
  // births also depend on FOOD: a starving settlement does not breed its way back to
  // health. So a chronically food-broken, trade-isolated place (geography's marginal,
  // dry, inland sites) can actually decline toward ruin instead of bouncing back.
  const foodYears = s.econ.stock[SUBSISTENCE_RESOURCE] / Math.max(1, m.population);
  const foodFactor = 0.25 + 0.75 * clamp(foodYears, 0, 1);
  // aggregate fertility is SPECIES DATA: an ordinary people = 1, a non-reproducing
  // construct society = 0 (its numbers only change by migration & mortality).
  const fertility = macroFertilityOf(m.dominantSpecies);
  const births = Math.max(0, Math.round(m.adults * (0.024 + 0.07 * room) * (1 + m.stability / 300) * foodFactor * fertility));
  m.children += births;

  // Mortality scales with the dominant species' OWN lifespan — consistent with the
  // per-species maturation above — so long-lived peoples also die more slowly in
  // aggregate and demographics stay balanced instead of long-lived ones bleeding out.
  const lifespan = speciesById(m.dominantSpecies).lifespan;
  const lifeScale = REF_LIFESPAN / lifespan; // <1 for long-lived, >1 for short-lived
  const elderMort = Math.min(0.12, 1 / Math.max(4, lifespan - eld)); // elders live out their remaining span
  let deaths = Math.round(m.children * 0.004 * lifeScale + m.adults * 0.008 * lifeScale + m.elders * elderMort);
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

    // relations settle toward how culturally COMPATIBLE the two peoples are: aligned
    // values pull toward friendship, opposed values toward hostility — so wars have a
    // REASON, not dice. (Trade nudges it further up in economyYearly.)
    const dist = culturalDistance(A.cultureId, B.cultureId);
    const cultureTarget = clamp(Math.round((20 - dist) * 1.1), -42, 26);
    e.relation = clamp(Math.round(e.relation * 0.92 + cultureTarget * 0.08) + rng.range(-4, 4), -100, 100);
    // a rare border grievance sharply sours relations — the spark that lights the war
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
      if (strong.macro.population > weak.macro.population * 1.28 && rng.chance(0.82)) {
        // a decisive CONQUEST — the weaker is razed under the victor's ruler.
        // Geography makes these mismatches: a fertile great city against a poor village.
        // We only empty it here (the war's cause); recordRuins then registers the fall as
        // a 'ruined' landmark naming the FALLEN settlement's last ruler — a razed town is
        // still a ruin on the map, however it died.
        weak.macro = { ...weak.macro, population: 0, children: 0, adults: 0, elders: 0 };
        strong.macro.stability = clamp(strong.macro.stability - rng.range(2, 6), -100, 100);
        const subjects = strong.currentRulerId !== undefined ? [strong.currentRulerId] : [];
        emit(world, 'conquest', subjects, { victor: strong.name, fallen: weak.name, reason: mostOpposedValue(A.cultureId, B.cultureId) });
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
        emit(world, 'battle', subjects, { a: A.name, b: B.name, aToll, bToll, reason: mostOpposedValue(A.cultureId, B.cultureId) });
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
      emit(world, 'raid', [], { raider: raider.name, victim: victim.name, toll, reason: mostOpposedValue(A.cultureId, B.cultureId) });
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
    for (const r of RESOURCES) {
      const prod = e.production[r] * pop;
      const cons = CONSUMPTION[r] * pop;
      e.stock[r] = Math.max(0, e.stock[r] + prod - cons);
    }
    e.wealth = Math.max(0, e.wealth * 0.96 + e.production[PREMIUM_RESOURCE] * pop * BASE_PRICE[PREMIUM_RESOURCE] * 0.03);
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
    for (const r of RESOURCES) {
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
    const foodYears = s.econ.stock[SUBSISTENCE_RESOURCE] / pop;

    if (s.detailed) {
      // The focused settlement's economy now shapes the people you're watching:
      // morale (stability) settles toward how well the town feeds itself and how
      // wealthy it is, and that flows into the safety need (see needs.ts). NON-lethal
      // on purpose — the abstract economy can't reliably feed a non-farming town's
      // full population, so a food-poor focus is *grim* (low morale/safety, lean
      // larders) rather than a death spiral (which made such towns unplayable).
      const target = clamp(Math.round(-50 + foodYears * 55 + (s.econ.wealth > 600 ? 15 : 0)), -80, 90);
      s.macro.stability = clamp(Math.round(s.macro.stability + (target - s.macro.stability) * 0.2), -100, 100);
      if (foodYears < 0.5) {
        for (const id of fullActors(world)) {
          const n = world.needs.get(id);
          if (n) n[SUBSISTENCE_NEED] = clamp(n[SUBSISTENCE_NEED] - 80, 0, 1000); // lean years pinch the larder
        }
        if (Math.floor(world.tick / DAYS_PER_YEAR) % 4 === 0) {
          emit(world, 'famine', [], { name: s.name, toll: 0 }); // a hunger warning, no deaths
        }
      }
      continue;
    }

    if (foodYears < 0.5) {
      const toll = Math.round((0.5 - foodYears) * pop * 0.4);
      if (toll > 0) {
        raidMacro(s.macro, toll);
        s.macro.population = s.macro.children + s.macro.adults + s.macro.elders;
        s.macro.stability = clamp(s.macro.stability - 8, -100, 100);
        // the land bleeds the people every lean year, but only a SEVERE famine is
        // worth remembering — chronic marginal hunger shouldn't flood the chronicle.
        if (toll >= Math.max(3, pop * 0.025)) emit(world, 'famine', [], { name: s.name, toll });
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
  // Neither the player (leaving is their choice) nor the sitting ruler (who must
  // stay to rule, else the seat is held by someone who wandered off) is moved
  // involuntarily.
  const rulerId = world.settlements[focusedId].currentRulerId;
  const leavers = fullActors(world).filter(
    (id) =>
      id !== world.playerId &&
      id !== rulerId &&
      world.lifecycle.get(id)!.ageYears >= maturityOf(world.identity.get(id)!.speciesId),
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
