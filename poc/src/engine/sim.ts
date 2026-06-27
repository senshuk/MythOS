/**
 * Simulation orchestrator. Builds a multi-settlement world, runs the multi-rate
 * scheduler (full fidelity for the focused settlement + aggregate macro for the
 * rest), and produces read-only snapshots / inspections for the UI. Also exposes
 * a headless runner + canonical serialization for the determinism tests.
 */
import {
  type World,
  type EntityId,
  type Snapshot,
  type ActorView,
  type EventView,
  type ActorDetail,
  type RelationView,
  type EventChain,
  type WorldEvent,
  type SettlementView,
  type SettlementId,
  type FigureDetail,
  type SettlementDetail,
  type PlayerView,
  type PlayerTargetView,
  DAYS_PER_YEAR,
} from './model';
import { type Intent } from './intent';
import { currentAspiration, aspirationLabel } from './aspiration';
export { checkPlayerGoal } from './aspiration';
import { Rng, mixSeed } from './rng';
import { createSubstrate } from './substrate';
import { fullActors, summaryActors, fullName, relCount, homeName, primarySpouse } from './world';
import { computeOpinion, opinionReasons } from './opinion';
import { chronicleYearly, renderLegend, eraTitle } from './chronicle';
import { directorYearly, directorDef, directorMood, initialDirector, DIRECTOR_OPTIONS } from './director';
import { figuresYearly, getFigure } from './figures';
import { focusSettlement } from './lod';
import { setStoryteller } from './director';
import { renderEvent, renderEventParts } from './render';

export { setStoryteller } from './director';
import { speciesById, maturityOf, governmentById, leaderTitleOf, cultureById, RESOURCES, SUBSISTENCE_RESOURCE } from '../content/fixture';
import { PLAYER_ACTIONS } from '../content/actions';
import { createSettlements, promote, macroYearly, summaryYearly, migrationYearly, geographyYearly, economyYearly } from './lod';
import { needsDaily } from '../systems/needs';
import { actWeekly } from '../systems/social';
import { lifecycleYearly } from '../systems/lifecycle';

export { focusSettlement } from './lod';
export { possess, release, schedulePlayerIntent } from './player';
import { schedulePlayerIntent } from './player';

/**
 * Build a world. With `focus` (default) it materializes settlement 0 to full
 * fidelity — the normal play/UI flow. With `focus = false` it starts **headless /
 * all-aggregate** (no settlement focused, no live actors): the mode used to run
 * deep worldgen pre-history cheaply for centuries before a player enters. A
 * settlement is then promoted on demand with `focusSettlement`.
 */
export function createWorld(seed: number, focus = true): World {
  const world: World = {
    seed,
    substrate: createSubstrate(seed),
    tick: 0,
    rng: new Rng(mixSeed(seed, 0xf0c)), // neutral stream until a settlement is focused
    settlements: [],
    edges: [],
    geoRngState: 0,
    focusedSettlementId: -1, // -1 = no settlement focused (headless / worldgen)
    homeSettlement: new Map(),
    fidelity: new Map(),
    nextEntityId: 1,
    nextEventId: 1,
    entities: [],
    identity: new Map(),
    names: new Map(),
    lifecycle: new Map(),
    needs: new Map(),
    traits: new Map(),
    profession: new Map(),
    ties: new Map(),
    memory: new Map(),
    rels: new Map(),
    events: [],
    chronicle: [],
    annals: [],
    chronicleCursor: 0,
    director: initialDirector(),
    directorRngState: mixSeed(seed, 0xd17),
    figures: [],
    figureRngState: mixSeed(seed, 0xf16),
    playerId: undefined,
    playerRngState: mixSeed(seed, 0x91a), // independent stream for player actions
    playerInputs: [],
  };

  createSettlements(world);

  if (focus) {
    // Focus settlement 0: activate its own RNG stream, then materialize it.
    // (Done directly, not via focusSettlement, so no focus-shift event at year 0.)
    world.focusedSettlementId = 0;
    world.rng.state = world.settlements[0].rngState;
    promote(world, world.settlements[0]);
  }

  return world;
}

/**
 * Advance one base tick (1 day). Cadences fire in a FIXED order; the focused
 * settlement runs full per-actor systems, all others advance as aggregates once
 * a year. This ordering is the determinism contract.
 */
export function stepTick(world: World): void {
  world.tick += 1;
  const hasFocus = world.focusedSettlementId >= 0;
  // Full-fidelity systems only run when a settlement is focused. In headless /
  // worldgen mode there are no live actors, so the world advances purely by the
  // aggregate, geography, economy, director and chronicle passes below.
  if (hasFocus) needsDaily(world); // focused actors, daily
  if (hasFocus && world.tick % 7 === 0) actWeekly(world); // focused actors, weekly
  if (world.tick % DAYS_PER_YEAR === 0) {
    if (hasFocus) lifecycleYearly(world); // focused settlement, full fidelity
    macroYearly(world); // every other settlement, aggregate
    geographyYearly(world); // relations drift & raids along the region graph
    economyYearly(world); // production, prices & goods trade along the routes
    summaryYearly(world); // named people living elsewhere, coarse fidelity
    migrationYearly(world); // people move between settlements (geography-weighted)
    directorYearly(world); // the storyteller paces drama (fires incidents)
    figuresYearly(world); // rulers age, die, and are succeeded (the line of history)
    chronicleYearly(world); // remember the year's most notable events (incl. director's)
  }
}

export function runDays(world: World, days: number): void {
  for (let i = 0; i < days; i++) stepTick(world);
}

export function runYears(world: World, years: number): void {
  runDays(world, years * DAYS_PER_YEAR);
}

/**
 * One player turn: schedule the player's chosen intent for the next weekly act
 * tick, then advance the world *exactly* to that tick — so the action resolves and
 * the sim pauses for the next decision. A no-op if no actor is possessed. The
 * intent goes through the normal input log, so a played session is still
 * deterministic & replayable from (seed, playerInputs).
 */
export function playerTurn(world: World, intent: Intent): void {
  if (world.playerId === undefined) return;
  const nextAct = (Math.floor(world.tick / 7) + 1) * 7; // next tick actWeekly fires
  schedulePlayerIntent(world, nextAct, intent);
  runDays(world, nextAct - world.tick);
}

/**
 * Forge a world with a deep past: run `years` of headless pre-history (cheap,
 * all-aggregate), then drop the player into the greatest surviving settlement —
 * which now carries a chronicle of named ages, legends, ruins, and dynasties.
 * The realization of "the world already exists." Deterministic from (seed, years).
 */
export function forgeWorld(seed: number, years: number, storyteller?: string): World {
  const world = createWorld(seed, false); // headless / all-aggregate
  if (storyteller) setStoryteller(world, storyteller);
  runYears(world, years);

  // the player enters the greatest surviving (non-ruined) settlement
  let entry = -1;
  let best = -1;
  for (const s of world.settlements) {
    if (s.ruinedYear !== undefined) continue;
    if (s.macro.population > best) {
      best = s.macro.population;
      entry = s.id;
    }
  }
  focusSettlement(world, entry >= 0 ? entry : 0);
  return world;
}

// ---------------------------------------------------------------- views ------

function actorView(world: World, id: EntityId): ActorView {
  const idn = world.identity.get(id)!;
  const lc = world.lifecycle.get(id)!;
  return {
    id,
    name: fullName(world, id),
    species: speciesById(idn.speciesId).name,
    sex: idn.sex,
    ageYears: lc.ageYears,
    alive: lc.alive,
    deathYear: lc.deathTick !== undefined ? Math.floor(lc.deathTick / DAYS_PER_YEAR) : undefined,
    profession: world.profession.get(id)!,
    traits: world.traits.get(id)!,
    spouse: primarySpouse(world, id),
    relationshipCount: relCount(world, id),
  };
}

function eventView(world: World, ev: WorldEvent): EventView {
  return {
    id: ev.id,
    year: ev.year,
    type: ev.type,
    text: renderEvent(world, ev),
    parts: renderEventParts(world, ev),
    subjects: ev.subjects,
    causes: ev.causes,
  };
}

/** Inspect a remembered historical FIGURE (a record — founder/ruler — not a live
 *  actor). Returns its dates/role and every event that names it. */
export function inspectFigure(world: World, id: EntityId): FigureDetail | undefined {
  const fig = world.figures.find((f) => f.id === id);
  if (!fig) return undefined;
  const lifeEvents = world.events.filter((ev) => ev.subjects.includes(id)).map((ev) => eventView(world, ev));
  return {
    id: fig.id,
    name: fig.name,
    species: speciesById(fig.species).name,
    role: fig.role,
    settlement: world.settlements[fig.settlementId]?.name ?? '?',
    settlementId: fig.settlementId,
    bornYear: fig.bornYear,
    deathYear: fig.deathYear,
    reignStart: fig.reignStart,
    reignEnd: fig.reignEnd,
    lifeEvents,
  };
}

/** Inspect a SETTLEMENT's whole recorded history: every event that names it (its
 *  founding, ruler line, wars, famines, ruin), newest first. */
export function inspectSettlement(world: World, id: SettlementId): SettlementDetail | undefined {
  const s = world.settlements[id];
  if (!s) return undefined;
  const events = world.events
    .filter(
      (ev) =>
        Object.values(ev.data).includes(s.name) ||
        ev.subjects.some((sid) => world.figures.find((f) => f.id === sid)?.settlementId === id),
    )
    .map((ev) => eventView(world, ev))
    .reverse();
  return { settlementId: id, events };
}

function settlementView(world: World, fullCount: number, summariesByHome: Map<number, string[]>): SettlementView[] {
  return world.settlements.map((s) => {
    const pop = s.detailed ? fullCount : s.macro.population;
    return {
      id: s.id,
      name: s.name,
      detailed: s.detailed,
      population: pop,
      foundedYear: s.foundedYear,
      dominantSpecies: speciesById(s.macro.dominantSpecies).name,
      stability: s.macro.stability,
      figureNames: summariesByHome.get(s.id) ?? [],
      ruinedYear: s.ruinedYear,
      government: governmentById(s.governmentId).title || 'free folk',
      leaderTitle: leaderTitleOf(s.governmentId),
      culture: cultureById(s.cultureId).name,
      founder: world.figures.find((f) => f.role === 'founder' && f.settlementId === s.id)?.name,
      ruler: getFigure(world, s.currentRulerId)?.name,
      specialization: s.econ.specialization,
      wealth: Math.round(s.econ.wealth),
      subsistenceSecurity: pop > 0 ? s.econ.stock[SUBSISTENCE_RESOURCE] / pop : 0,
      prices: { ...s.econ.price },
    };
  });
}

// the player's action menu is PACK DATA (content/actions.ts), not an engine constant

/** The controlled actor's actionable state, or undefined if no one is possessed
 *  (or the player has been freed from the world). */
function buildPlayerView(world: World): PlayerView | undefined {
  const id = world.playerId;
  if (id === undefined || !world.identity.has(id)) return undefined;
  const idn = world.identity.get(id)!;
  const lc = world.lifecycle.get(id)!;
  const homeId = world.homeSettlement.get(id);

  // valid targets: living adults in the focused settlement (the player's reach),
  // with the current bond surfaced; known relations first, then strangers.
  const myRels = world.rels.get(id)!;
  const targets: PlayerTargetView[] = [];
  for (const other of fullActors(world)) {
    if (other === id) continue;
    if (world.lifecycle.get(other)!.ageYears < maturityOf(world.identity.get(other)!.speciesId)) continue;
    const edge = myRels.get(other);
    let relation = 'stranger';
    let valence = 0;
    if (edge) {
      valence = Math.round(computeOpinion(edge, world.tick));
      relation = edge.flags.spouse
        ? 'spouse'
        : edge.flags.feud
          ? 'feud'
          : edge.flags.friend
            ? 'friend'
            : edge.flags.rival
              ? 'rival'
              : 'acquaintance';
    }
    targets.push({ id: other, name: fullName(world, other), relation, valence });
  }
  targets.sort(
    (a, b) =>
      (a.relation === 'stranger' ? 1 : 0) - (b.relation === 'stranger' ? 1 : 0) ||
      Math.abs(b.valence) - Math.abs(a.valence) ||
      a.id - b.id,
  );

  const asp = currentAspiration(world, id);

  // a recently-fulfilled goal, for a transient on-screen celebration (~3 months)
  let lastAchieved: string | undefined;
  for (let i = world.events.length - 1; i >= 0 && i > world.events.length - 300; i--) {
    const ev = world.events[i];
    if (ev.type === 'goal_met' && ev.subjects[0] === id && world.tick - ev.tick <= 90) {
      lastAchieved = renderEvent(world, ev);
      break;
    }
  }

  // a one-click pursue intent, only when the goal is directly actionable
  let suggested: Intent | undefined;
  if (asp.action === 'work') suggested = { kind: 'work' };
  else if (asp.target !== undefined && (asp.action === 'court' || asp.action === 'socialize')) {
    suggested = { kind: asp.action, target: asp.target };
  }

  return {
    id,
    name: fullName(world, id),
    species: speciesById(idn.speciesId).name,
    profession: world.profession.get(id)!,
    ageYears: lc.ageYears,
    alive: lc.alive,
    deathYear: lc.deathTick !== undefined ? Math.floor(lc.deathTick / DAYS_PER_YEAR) : undefined,
    settlement: homeId !== undefined ? world.settlements[homeId]?.name ?? '?' : '?',
    needs: { ...world.needs.get(id)! },
    aspiration: {
      kind: asp.kind,
      label: aspirationLabel(world, id, asp),
      targetName: asp.target !== undefined ? fullName(world, asp.target) : undefined,
      suggested,
    },
    lastAchieved,
    actions: PLAYER_ACTIONS,
    targets: targets.slice(0, 40),
  };
}

export function buildSnapshot(world: World, feedSize = 400): Snapshot {
  const full = fullActors(world); // the focused settlement
  const summaries = summaryActors(world); // named people living elsewhere
  // may be undefined in headless / worldgen mode (no settlement focused)
  const focused = world.focusedSettlementId >= 0 ? world.settlements[world.focusedSettlementId] : undefined;

  let born = 0;
  let died = 0;
  let marriages = 0;
  let feuds = 0;
  for (const ev of world.events) {
    if (ev.type === 'born') born++;
    else if (ev.type === 'died' || ev.type === 'died_brawl') died++;
    else if (ev.type === 'married') marriages++;
    else if (ev.type === 'feud') feuds++;
  }

  // world population = focused settlement's full count + every other macro headcount
  // (summary actors are named members already inside those macro headcounts)
  let worldPopulation = full.length;
  for (const s of world.settlements) if (!s.detailed) worldPopulation += s.macro.population;

  // group summary actors by the settlement they live in (the "still there" names)
  const summariesByHome = new Map<number, string[]>();
  for (const id of summaries) {
    const h = world.homeSettlement.get(id)!;
    const arr = summariesByHome.get(h) ?? [];
    if (arr.length < 6) arr.push(fullName(world, id));
    summariesByHome.set(h, arr);
  }

  const notable = [...full]
    .sort(
      (a, b) =>
        relCount(world, b) - relCount(world, a) ||
        world.lifecycle.get(b)!.ageYears - world.lifecycle.get(a)!.ageYears,
    )
    .slice(0, 8)
    .map((id) => actorView(world, id));

  const recent = world.events.slice(-feedSize).map((ev) => eventView(world, ev)).reverse();

  // The deep past lives in the ANNALS (permanent), so legends and named ages span
  // ALL of history — including a long pre-play worldgen — not just recent memory.
  const evById = new Map<number, WorldEvent>();
  for (const ev of world.events) evById.set(ev.id, ev);

  // legends: the most momentous tales of all time
  const chronicleViews = [...world.annals]
    .sort((a, b) => b.interest - a.interest || a.eventId - b.eventId)
    .slice(0, 14)
    .map((t) => {
      const ev = evById.get(t.eventId);
      return ev ? { year: t.year, interest: t.interest, text: renderLegend(world, ev) } : null;
    })
    .filter((v): v is { year: number; interest: number; text: string } => v !== null);

  // named ages: one defining event per year. Landmark years (foundings, ruins)
  // ALWAYS appear; the rest are filled by the most momentous years. Shown as a
  // chronological timeline of the world's great years (ancient → recent).
  const bestPerYear = new Map<number, { interest: number; eventId: number }>();
  const landmarkYears = new Set<number>();
  for (const t of world.annals) {
    if (t.landmark) landmarkYears.add(t.year);
    const cur = bestPerYear.get(t.year);
    if (!cur || t.interest > cur.interest || (t.interest === cur.interest && t.eventId < cur.eventId)) {
      bestPerYear.set(t.year, { interest: t.interest, eventId: t.eventId });
    }
  }
  const named = [...bestPerYear.entries()].filter(([, b]) => b.interest >= 35);
  const landmarks = named.filter(([y]) => landmarkYears.has(y));
  const rest = named
    .filter(([y]) => !landmarkYears.has(y))
    .sort((a, b) => b[1].interest - a[1].interest)
    .slice(0, Math.max(0, 16 - landmarks.length));
  const eras = [...landmarks, ...rest]
    .sort((a, b) => a[0] - b[0]) // chronological — a timeline of ages
    .map(([year, best]) => {
      const ev = evById.get(best.eventId);
      return ev ? { year, title: eraTitle(world, ev) } : null;
    })
    .filter((v): v is { year: number; title: string } => v !== null);

  // renowned figures of history: those who reigned longest (founders & great rulers)
  const curYear = Math.floor(world.tick / DAYS_PER_YEAR);
  const historicalFigures = [...world.figures]
    .sort((a, b) => ((b.deathYear ?? curYear) - b.reignStart) - ((a.deathYear ?? curYear) - a.reignStart) || a.id - b.id)
    .slice(0, 14)
    .map((f) => ({
      name: f.name,
      role: f.role,
      settlement: world.settlements[f.settlementId]?.name ?? '?',
      bornYear: f.bornYear,
      deathYear: f.deathYear,
      reignStart: f.reignStart,
      reignEnd: f.deathYear === undefined ? f.reignEnd : undefined,
    }));

  return {
    seed: world.seed,
    year: Math.floor(world.tick / DAYS_PER_YEAR),
    tick: world.tick,
    settlementName: focused?.name ?? '(the wider world)',
    population: full.length,
    totalBorn: born,
    totalDied: died,
    marriages,
    feuds,
    notable,
    actors: world.entities.map((id) => actorView(world, id)),
    recentEvents: recent,

    focusedSettlementId: world.focusedSettlementId,
    worldPopulation,
    simulatedInDetail: full.length,
    namedPeople: summaries.length,
    worldWealth: Math.round(world.settlements.reduce((sum, s) => sum + s.econ.wealth, 0)),
    settlements: settlementView(world, full.length, summariesByHome),
    map: {
      nodes: world.settlements.map((s) => ({
        id: s.id,
        name: s.name,
        x: s.pos.x,
        y: s.pos.y,
        population: s.detailed ? full.length : s.macro.population,
        detailed: s.detailed,
        ruined: s.ruinedYear !== undefined,
        cultureId: s.cultureId,
      })),
      edges: world.edges.map((e) => ({
        a: e.a,
        b: e.b,
        relation: e.relation,
        distance: e.distance,
        tradeVolume: e.tradeVolume,
      })),
    },
    chronicle: chronicleViews,
    eras,
    director: {
      personality: world.director.personality,
      label: directorDef(world.director.personality).label,
      tension: Math.round(world.director.tension),
      incidents: world.director.incidents,
      mood: directorMood(world),
      options: DIRECTOR_OPTIONS,
    },
    historicalFigures,
    player: buildPlayerView(world),
  };
}

export function inspectActor(world: World, id: EntityId): ActorDetail | undefined {
  if (!world.identity.has(id)) return undefined;
  const myHome = world.homeSettlement.get(id);
  const relationships: RelationView[] = [];
  for (const [otherId, edge] of world.rels.get(id)!) {
    const otherHome = world.homeSettlement.get(otherId);
    const away = otherHome !== undefined && otherHome !== myHome;
    relationships.push({
      otherId,
      otherName: fullName(world, otherId),
      valence: Math.round(computeOpinion(edge, world.tick)),
      kind: edge.flags.spouse
        ? 'spouse'
        : edge.flags.feud
          ? 'feud'
          : edge.flags.friend
            ? 'friend'
            : edge.flags.rival
              ? 'rival'
              : 'acquaintance',
      reasons: opinionReasons(edge, world.tick),
      away,
      otherSettlement: away ? homeName(world, otherId) : undefined,
    });
  }
  relationships.sort((a, b) => b.valence - a.valence);

  const lifeEvents = world.events
    .filter((ev) => ev.subjects.includes(id))
    .map((ev) => eventView(world, ev));

  return { actor: actorView(world, id), relationships, lifeEvents };
}

/** Walk the causal ancestry of an event (breadth-first, de-duplicated). */
export function inspectEvent(world: World, id: number): EventChain | undefined {
  const byId = new Map<number, WorldEvent>();
  for (const ev of world.events) byId.set(ev.id, ev);
  const root = byId.get(id);
  if (!root) return undefined;

  const ancestors: EventView[] = [];
  const seen = new Set<number>([id]);
  let frontier = [...root.causes];
  while (frontier.length) {
    const next: number[] = [];
    for (const cid of frontier) {
      if (seen.has(cid)) continue;
      seen.add(cid);
      const ev = byId.get(cid);
      if (!ev) continue;
      ancestors.push(eventView(world, ev));
      next.push(...ev.causes);
    }
    frontier = next;
  }
  return { root: eventView(world, root), ancestors };
}

// ------------------------------------------------ determinism support --------

export function runHeadless(seed: number, years: number): World {
  const world = createWorld(seed);
  runYears(world, years);
  return world;
}

/** Canonical, order-stable serialization of final world state for hashing. */
export function canonicalize(world: World): string {
  const parts: string[] = [
    `seed=${world.seed}`,
    `tick=${world.tick}`,
    `focus=${world.focusedSettlementId}`,
    `rng=${world.rng.state}`,
    `geo=${world.geoRngState}`,
    `events=${world.events.length}`,
    `nextEntity=${world.nextEntityId}`,
  ];
  for (const id of world.entities) {
    const idn = world.identity.get(id)!;
    const lc = world.lifecycle.get(id)!;
    const ties = world.ties.get(id)!;
    let relSum = 0;
    for (const [, e] of world.rels.get(id)!) relSum += computeOpinion(e, world.tick);
    relSum = Math.round(relSum);
    parts.push(
      `#${id}:${idn.given}.${idn.family}.${idn.speciesId}.${idn.sex}.` +
        `age${lc.ageYears}.alive${lc.alive ? 1 : 0}.death${lc.deathTick ?? -1}.` +
        `fid${world.fidelity.get(id) ?? '-'}.home${world.homeSettlement.get(id) ?? -1}.` +
        `sp${ties.spouses.join('-') || -1}.ch${ties.children.length}.rels${world.rels.get(id)!.size}.rsum${relSum}`,
    );
  }
  for (const s of world.settlements) {
    const m = s.macro;
    parts.push(
      `@${s.id}:${s.name}.det${s.detailed ? 1 : 0}.ep${s.epoch}.rng${s.rngState}.ruin${s.ruinedYear ?? -1}.gov${s.governmentId}.cul${s.cultureId}.rl${s.currentRulerId ?? -1}.` +
        `pop${m.population}.c${m.children}.a${m.adults}.e${m.elders}.stab${m.stability}.` +
        `dom${m.dominantSpecies}.spec${s.econ.specialization}.w${Math.round(s.econ.wealth)}.` +
        // resources serialized generically over the pack's RESOURCES vector
        RESOURCES.map((r) => `s_${r}${Math.round(s.econ.stock[r] ?? 0)}.p_${r}${Math.round((s.econ.price[r] ?? 0) * 100)}`).join('.'),
    );
  }
  for (const e of world.edges) {
    parts.push(`~${e.a}-${e.b}:rel${e.relation}.tv${Math.round(e.tradeVolume)}`);
  }
  parts.push(
    `director=${world.director.personality}.t${Math.round(world.director.tension)}.` +
      `n${world.director.incidents}.last${world.director.lastIncidentYear}.drng${world.directorRngState}`,
  );
  parts.push(`chronicleCursor=${world.chronicleCursor}`);
  for (const t of [...world.chronicle].sort((a, b) => a.eventId - b.eventId)) {
    parts.push(`!${t.eventId}:y${t.year}.i${t.interest}`);
  }
  for (const t of [...world.annals].sort((a, b) => a.eventId - b.eventId)) {
    parts.push(`*${t.eventId}:y${t.year}.i${t.interest}.l${t.landmark ? 1 : 0}`);
  }
  for (const f of world.figures) {
    parts.push(`F${f.id}:${f.name}.${f.role}.s${f.settlementId}.b${f.bornYear}.d${f.deathYear ?? -1}.r${f.reignStart}-${f.reignEnd}`);
  }
  parts.push(`player=${world.playerId ?? -1}.prng${world.playerRngState}.inputs${world.playerInputs.length}`);
  parts.push(`figrng=${world.figureRngState}`);
  parts.push(`pgoal=${world.playerGoal ? `${world.playerGoal.kind}.${world.playerGoal.target ?? -1}` : '-'}`);
  return parts.join('\n');
}

/** Cheap, stable FNV-1a hash of the canonical string. */
export function hashWorld(world: World): string {
  const s = canonicalize(world);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
