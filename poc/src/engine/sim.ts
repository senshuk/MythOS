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
import { fullActors, summaryActors, fullName, relCount, homeName, primarySpouse, getEvent } from './world';
import { computeOpinion, opinionReasons } from './opinion';
import { computeStanding, standingReasons, emptyReputation } from './reputation';
import { chronicleYearly, renderLegend, eraTitle } from './chronicle';
import { directorYearly, directorDef, directorMood, initialDirector, DIRECTOR_OPTIONS } from './director';
import { figuresYearly, getFigure, houseById } from './figures';
import { focusSettlement } from './lod';
import { setStoryteller } from './director';
import { renderEvent, renderEventParts } from './render';

export { setStoryteller } from './director';
import { speciesById, maturityOf, governmentById, leaderTitleOf, cultureById, deityById, patronDeityOf, ethicsTaboos, natureOf, RESOURCES, SUBSISTENCE_RESOURCE } from '../content/fixture';
import { personalityOf } from './social';
import { eventInterest } from '../content/narrative';
import { PLAYER_ACTIONS } from '../content/actions';
import { createSettlements, promote, macroYearly, summaryYearly, migrationYearly, geographyYearly, economyYearly } from './lod';
import { travelTick } from './travel';
import { getOrganization, roleHistory, ROLE_LEADER, ROLE_FOUNDER } from './organization';
import { needsDaily } from '../systems/needs';
import { actWeekly } from '../systems/social';
import { lifecycleYearly } from '../systems/lifecycle';
import { religionYearly } from './religion';
import { factionYearly, factionOf, civilWarYearly, exileYearly } from './factions';

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
    locations: new Map(),
    nextLocationId: 0,
    childrenByParent: new Map(),
    edges: [],
    geoRngState: 0,
    travelRngState: mixSeed(seed, 0x713a), // dedicated transit-hazard stream

    focusedSettlementId: -1, // -1 = no settlement focused (headless / worldgen)
    homeSettlement: new Map(),
    fidelity: new Map(),
    nextEntityId: 1,
    nextEventId: 1,
    entities: [],
    deadEntities: [],
    firstEventId: 1,
    eventArchive: new Map(),
    stats: { born: 0, died: 0, marriages: 0, feuds: 0 },
    eventsBySubject: new Map(),
    eventsBySettlement: new Map(),
    identity: new Map(),
    names: new Map(),
    lifecycle: new Map(),
    needs: new Map(),
    traits: new Map(),
    personality: new Map(),
    profession: new Map(),
    ties: new Map(),
    memory: new Map(),
    reputation: new Map(),
    faith: new Map(),
    exiles: new Map(),
    rels: new Map(),
    events: [],
    chronicle: [],
    annals: [],
    chronicleCursor: 0,
    director: initialDirector(),
    directorRngState: mixSeed(seed, 0xd17),
    figures: [],
    figuresById: new Map(),
    figuresBySettlement: new Map(),
    houses: [],
    organizations: [],
    organizationsById: new Map(),
    orgMembers: new Map(),
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
  // resolve in-flight journeys first, every tick and regardless of focus (vehicles travel
  // world-wide). A no-op when nothing is in transit — the default world founds no vehicles.
  travelTick(world);
  const hasFocus = world.focusedSettlementId >= 0;
  // Full-fidelity systems only run when a settlement is focused. In headless /
  // worldgen mode there are no live actors, so the world advances purely by the
  // aggregate, geography, economy, director and chronicle passes below.
  // computed once per tick — shared by daily, weekly, and (on year-end days) yearly systems.
  const actors = hasFocus ? fullActors(world) : [];
  if (hasFocus) {
    needsDaily(world, actors);
    if (world.tick % 7 === 0) actWeekly(world, actors);
  }
  if (world.tick % DAYS_PER_YEAR === 0) {
    if (hasFocus) lifecycleYearly(world, actors); // focused settlement, full fidelity
    if (hasFocus) religionYearly(world); // faith bonds, friction, conversion & apostasy
    if (hasFocus) factionYearly(world); // faction split recomputed before succession check
    macroYearly(world); // every other settlement, aggregate
    geographyYearly(world); // relations drift & raids along the region graph
    economyYearly(world); // production, prices & goods trade along the routes
    summaryYearly(world); // named people living elsewhere, coarse fidelity
    migrationYearly(world); // people move between settlements (geography-weighted)
    directorYearly(world); // the storyteller paces drama (fires incidents)
    figuresYearly(world); // rulers age, die, and are succeeded (the line of history)
    if (hasFocus) civilWarYearly(world); // resolve civil wars after the grace period
    if (hasFocus) exileYearly(world);   // formal return of exiles after EXILE_RETURN_YEARS
    chronicleYearly(world); // remember the year's most notable events (incl. director's)
    compactEvents(world); // prune unreferenced old events; archive referenced ones
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
    nature: natureOf(personalityOf(world, id)),
    house: idn.family, // their lineage — the surname carried down their family line
    spouse: primarySpouse(world, id),
    relationshipCount: relCount(world, id),
    standing: Math.round(computeStanding(world.reputation.get(id) ?? emptyReputation(), world.tick)),
    faith: (() => { const f = world.faith.get(id); return f ? deityById(f).name : undefined; })(),
    factionName: (() => {
      const pole = factionOf(world, id);
      if (!pole || !world.factionSplit) return undefined;
      return pole === 'high' ? world.factionSplit.highName : world.factionSplit.lowName;
    })(),
    exiledFrom: (() => {
      const rec = world.exiles.get(id);
      return rec ? world.settlements[rec.fromSettlementId]?.name : undefined;
    })(),
  };
}

// event-data keys that can name a settlement — used to tell whether an event concerns the
// focused place (so the feed can scope to it / always keep its happenings legible).
const PLACE_KEYS = ['settlement', 'name', 'from', 'to', 'a', 'b', 'victim', 'raider', 'victor', 'fallen', 'place'];
function eventConcernsFocused(world: World, ev: WorldEvent): boolean {
  const fid = world.focusedSettlementId;
  for (const id of ev.subjects) if (world.homeSettlement.get(id) === fid) return true;
  const fname = world.settlements[fid]?.name;
  if (fname) for (const k of PLACE_KEYS) if (ev.data[k] === fname) return true;
  return false;
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
    interest: eventInterest(ev.type, ev.data),
    local: eventConcernsFocused(world, ev),
    involvesPlayer: world.playerId !== undefined && ev.subjects.includes(world.playerId),
  };
}

/** Inspect a remembered historical FIGURE (a record — founder/ruler — not a live
 *  actor). Returns its dates/role and every event that names it. */
export function inspectFigure(world: World, id: EntityId): FigureDetail | undefined {
  const fig = world.figuresById.get(id);
  if (!fig) return undefined;
  const lifeEvents = (world.eventsBySubject.get(id) ?? [])
    .map((eid) => getEvent(world, eid))
    .filter((ev): ev is WorldEvent => ev !== undefined)
    .map((ev) => eventView(world, ev));
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
    house: houseById(world, fig.houseId)?.name,
    lifeEvents,
  };
}

/** Inspect a SETTLEMENT's whole recorded history: every event that names it (its
 *  founding, ruler line, wars, famines, ruin), newest first. */
export function inspectSettlement(world: World, id: SettlementId): SettlementDetail | undefined {
  const s = world.settlements[id];
  if (!s) return undefined;
  // Union: events where this settlement is explicitly indexed + events where one of its
  // figures is a subject. All three lookups are O(1) via the reverse indexes.
  const eventIds = new Set<number>(world.eventsBySettlement.get(id) ?? []);
  for (const fid of world.figuresBySettlement.get(id) ?? []) {
    for (const eid of world.eventsBySubject.get(fid) ?? []) eventIds.add(eid);
  }
  const events = [...eventIds]
    .sort((a, b) => b - a) // event IDs are monotonic — descending = newest first
    .map((eid) => getEvent(world, eid))
    .filter((ev): ev is WorldEvent => ev !== undefined)
    .map((ev) => eventView(world, ev));
  return { settlementId: id, events };
}

function settlementView(world: World, fullCount: number, summariesByHome: Map<number, string[]>): SettlementView[] {
  return world.settlements.map((s) => {
    const pop = s.detailed ? fullCount : s.macro.population;
    return {
      id: s.id,
      name: s.name,
      nameMeaning: s.nameMeaning,
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
      culturalTaboos: ethicsTaboos(s.cultureId),
      patronDeity: (({ name, domain }) => ({ name, domain }))(patronDeityOf(s.cultureId)),
      founder: s.founderName,
      ruler: getFigure(world, s.currentRulerId)?.name,
      polity: (() => {
        const org = getOrganization(world, s.polityId);
        if (!org) return undefined;
        const founder = roleHistory(world, org.id, ROLE_FOUNDER)[0];
        return {
          name: org.name,
          subtype: org.subtype,
          leaderName: getFigure(world, org.leaderId)?.name,
          founderName: founder ? getFigure(world, founder.actorId)?.name : undefined,
          leaderCount: roleHistory(world, org.id, ROLE_LEADER).length,
          standing: Math.round(computeStanding(world.reputation.get(org.id) ?? emptyReputation(), world.tick)),
        };
      })(),
      specialization: s.econ.specialization,
      wealth: Math.round(s.econ.wealth),
      subsistenceSecurity: pop > 0 ? s.econ.stock[SUBSISTENCE_RESOURCE] / pop : 0,
      prices: { ...s.econ.price },
      factionSplit: s.id === world.focusedSettlementId && world.factionSplit
        ? { axis: world.factionSplit.axis, highName: world.factionSplit.highName, lowName: world.factionSplit.lowName }
        : undefined,
      civilWarYear: s.id === world.focusedSettlementId && s.civilWarTick !== undefined
        ? Math.floor(s.civilWarTick / DAYS_PER_YEAR)
        : undefined,
    };
  });
}

// the player's action menu is PACK DATA (content/actions.ts), not an engine constant

/** The controlled actor's actionable state, or undefined if no one is possessed
 *  (or the player has been freed from the world). */
function buildPlayerView(world: World, actors: EntityId[]): PlayerView | undefined {
  const id = world.playerId;
  if (id === undefined || !world.identity.has(id)) return undefined;
  const idn = world.identity.get(id)!;
  const lc = world.lifecycle.get(id)!;
  const homeId = world.homeSettlement.get(id);

  // valid targets: living adults in the focused settlement (the player's reach),
  // with the current bond surfaced; known relations first, then strangers.
  const myRels = world.rels.get(id)!;
  const targets: PlayerTargetView[] = [];
  for (const other of actors) {
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

  const { born, died, marriages, feuds } = world.stats;

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
  // legends: the most momentous tales of all time
  const chronicleViews = [...world.annals]
    .sort((a, b) => b.interest - a.interest || a.eventId - b.eventId)
    .slice(0, 14)
    .map((t) => {
      const ev = getEvent(world, t.eventId);
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
      const ev = getEvent(world, best.eventId);
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
      house: houseById(world, f.houseId)?.name,
    }));

  // the great Houses, ranked by prestige — how many of each line's members held a seat
  // gives the depth of the dynasty.
  // distinct figures per house (an actor re-crowned leaves duplicate figure records that
  // share an id, so count by id, not by record).
  const houseRulers = new Map<number, Set<number>>();
  for (const f of world.figures) {
    if (f.houseId === undefined) continue;
    let set = houseRulers.get(f.houseId);
    if (!set) houseRulers.set(f.houseId, (set = new Set()));
    set.add(f.id);
  }
  const houses = [...world.houses]
    .sort((a, b) => b.prestige - a.prestige || a.id - b.id)
    .slice(0, 12)
    .map((h) => ({
      name: h.name,
      foundedYear: h.foundedYear,
      prestige: Math.round(h.prestige),
      origin: world.settlements[h.originSettlementId]?.name ?? '?',
      seat: h.seatSettlementId !== undefined ? world.settlements[h.seatSettlementId]?.name : undefined,
      rulers: houseRulers.get(h.id)?.size ?? 1,
      extinctYear: h.extinctYear,
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
    actors: [...world.entities, ...world.deadEntities].map((id) => actorView(world, id)),
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
        nameMeaning: s.nameMeaning,
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
    houses,
    player: buildPlayerView(world, full),
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

  const lifeEvents = (world.eventsBySubject.get(id) ?? [])
    .map((eid) => getEvent(world, eid))
    .filter((ev): ev is WorldEvent => ev !== undefined)
    .map((ev) => eventView(world, ev));

  const rep = world.reputation.get(id) ?? emptyReputation();
  const reputation = {
    standing: Math.round(computeStanding(rep, world.tick)),
    reasons: standingReasons(rep, world.tick),
  };

  return { actor: actorView(world, id), relationships, lifeEvents, reputation };
}

/** Walk the causal ancestry of an event (breadth-first, de-duplicated).
 *  getEvent() handles both the recent buffer and the archive transparently. */
export function inspectEvent(world: World, id: number): EventChain | undefined {
  const root = getEvent(world, id);
  if (!root) return undefined;

  const ancestors: EventView[] = [];
  const seen = new Set<number>([id]);
  let frontier = [...root.causes];
  while (frontier.length) {
    const next: number[] = [];
    for (const cid of frontier) {
      if (seen.has(cid)) continue;
      seen.add(cid);
      const ev = getEvent(world, cid);
      if (!ev) continue;
      ancestors.push(eventView(world, ev));
      next.push(...ev.causes);
    }
    frontier = next;
  }
  return { root: eventView(world, root), ancestors };
}

// -------------------------------------------- event compaction ---------------

/**
 * Yearly mark-and-sweep: events older than COMPACT_WINDOW_YEARS are either archived
 * (if still reachable from annals / chronicle / actor memory or their cause chains)
 * or discarded (if nothing in the world still references them). This bounds
 * world.events to ~COMPACT_WINDOW_YEARS × events-per-year regardless of how long
 * the simulation runs, while preserving every causal chain the player can follow.
 *
 * Must run AFTER chronicleYearly so this year's events are protected before sweeping.
 */
const COMPACT_WINDOW_YEARS = 10;

export function compactEvents(world: World): void {
  const cutoffTick = world.tick - COMPACT_WINDOW_YEARS * DAYS_PER_YEAR;

  // Find how many leading events are old enough to consider pruning.
  let cutIdx = 0;
  while (cutIdx < world.events.length && world.events[cutIdx].tick <= cutoffTick) {
    cutIdx++;
  }
  if (cutIdx === 0) return;

  // Mark phase: BFS from all stable roots to collect referenced event IDs.
  const live = new Set<number>();
  for (const t of world.annals) live.add(t.eventId);
  for (const t of world.chronicle) live.add(t.eventId);
  for (const [, ids] of world.memory) for (const id of ids) live.add(id);

  // Transitively chase cause[] chains so inspectEvent can still trace full ancestry.
  const queue = [...live];
  const visited = new Set<number>(live);
  while (queue.length) {
    const evId = queue.pop()!;
    const ev = getEvent(world, evId);
    if (!ev) continue;
    for (const cid of ev.causes) {
      if (!visited.has(cid)) {
        visited.add(cid);
        live.add(cid);
        queue.push(cid);
      }
    }
  }

  // Sweep: move live old events to the archive; discard the rest.
  for (let i = 0; i < cutIdx; i++) {
    const ev = world.events[i];
    if (live.has(ev.id)) world.eventArchive.set(ev.id, ev);
  }

  world.events.splice(0, cutIdx);
  world.firstEventId += cutIdx;

  // Sweep reverse indexes: drop entries whose event was discarded (not archived, not recent).
  // Runs after firstEventId is updated so the "recent" threshold is correct.
  for (const [subj, ids] of world.eventsBySubject) {
    const kept = ids.filter((id) => id >= world.firstEventId || world.eventArchive.has(id));
    if (kept.length === 0) world.eventsBySubject.delete(subj);
    else if (kept.length < ids.length) world.eventsBySubject.set(subj, kept);
  }
  for (const [sid, ids] of world.eventsBySettlement) {
    const kept = ids.filter((id) => id >= world.firstEventId || world.eventArchive.has(id));
    if (kept.length === 0) world.eventsBySettlement.delete(sid);
    else if (kept.length < ids.length) world.eventsBySettlement.set(sid, kept);
  }
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
    `travel=${world.travelRngState}`,
    `events=${world.nextEventId - 1}.first=${world.firstEventId}.arch=${world.eventArchive.size}`,
    `stats=born${world.stats.born}.died${world.stats.died}.wed${world.stats.marriages}.feud${world.stats.feuds}`,
    `nextEntity=${world.nextEntityId}`,
  ];
  const serializeEntity = (id: EntityId): void => {
    const idn = world.identity.get(id)!;
    const lc = world.lifecycle.get(id)!;
    const ties = world.ties.get(id)!;
    let relSum = 0;
    for (const [, e] of world.rels.get(id)!) relSum += computeOpinion(e, world.tick);
    relSum = Math.round(relSum);
    const standing = Math.round(computeStanding(world.reputation.get(id) ?? emptyReputation(), world.tick));
    parts.push(
      `#${id}:${idn.given}.${idn.family}.${idn.speciesId}.${idn.sex}.` +
        `age${lc.ageYears}.alive${lc.alive ? 1 : 0}.death${lc.deathTick ?? -1}.` +
        `fid${world.fidelity.get(id) ?? '-'}.home${world.homeSettlement.get(id) ?? -1}.` +
        `sp${ties.spouses.join('-') || -1}.ch${ties.children.length}.rels${world.rels.get(id)!.size}.rsum${relSum}.rep${standing}.faith${world.faith.get(id) ?? ''}`,
    );
  };
  for (const id of world.entities) serializeEntity(id);
  for (const id of world.deadEntities) serializeEntity(id);
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
  // generic (non-settlement) locations: the spatial tree + any in-flight transit. Empty in
  // the default world, so this appends nothing there and existing hashes are unaffected.
  const settlementIdSet = new Set(world.settlements.map((s) => s.id));
  for (const id of [...world.locations.keys()].sort((a, b) => a - b)) {
    if (settlementIdSet.has(id)) continue;
    const l = world.locations.get(id)!;
    const t = l.transit;
    parts.push(
      `L${l.id}:${l.locationType}.mob${l.mobility === 'mobile' ? 1 : 0}.par${l.parentId ?? -1}.dock${l.dockedAt ?? -1}.` +
        `pos${l.pos ? `${Math.round(l.pos.x)},${Math.round(l.pos.y)}` : '-'}.` +
        (t ? `tr${Math.round(t.toPos.x)},${Math.round(t.toPos.y)}.arr${t.arriveTick}.dly${t.delayTicks}` : 'tr-'),
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
    parts.push(`F${f.id}:${f.name}.${f.role}.s${f.settlementId}.b${f.bornYear}.d${f.deathYear ?? -1}.r${f.reignStart}-${f.reignEnd}.h${f.houseId ?? -1}`);
  }
  for (const h of world.houses) {
    parts.push(`H${h.id}:${h.name}.f${h.founderId}.y${h.foundedYear}.p${Math.round(h.prestige)}.seat${h.seatSettlementId ?? -1}.x${h.extinctYear ?? -1}`);
  }
  for (const o of world.organizations) {
    const standing = Math.round(computeStanding(world.reputation.get(o.id) ?? emptyReputation(), world.tick));
    // roster digest: each record as role@actor[since:until] so institutional memory is hashed
    const roster = (world.orgMembers.get(o.id) ?? [])
      .map((m) => `${m.role}@${m.actorId}:${m.sinceTick}-${m.untilTick ?? -1}`)
      .join(',');
    parts.push(`O${o.id}:${o.subtype}.gov${o.governanceId}.ld${o.leaderId ?? -1}.seat${o.seatId ?? -1}.dis${o.dissolvedYear ?? -1}.sh${o.seatHistory.join('-')}.rep${standing}.mem[${roster}]`);
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
