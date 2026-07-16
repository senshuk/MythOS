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
  type BeliefView,
  type RelationView,
  type EventChain,
  type CauseNode,
  type WorldEvent,
  type SettlementView,
  type SettlementId,
  type FigureDetail,
  type SettlementDetail,
  type HouseDetail,
  type CultureDetail,
  type DeityDetail,
  type FeatureDetail,
  type PlayerView,
  type PlayerTargetView,
  type StoryBeat,
  type Tension,
  type CastMember,
  type NeedFeel,
  type OrgId,
  type OrgIntentView,
  type EventRef,
  type PeekCard,
  type HouseholdView,
  type HouseholdMember,
  type VenueDetail,
  DAYS_PER_YEAR,
} from './model';
import { type Intent } from './intent';
import { currentAspiration, aspirationLabel } from './aspiration';
export { checkPlayerGoal } from './aspiration';
export { chooseAmbition, abandonAmbition, reviewPlayerAmbition } from './ambition';
import { Rng, mixSeed } from './rng';
import { createSubstrate, SurfaceSubstrate } from './substrate';
import { fullActors, summaryActors, fullName, relCount, homeName, primarySpouse, getEvent, isKin, pruneRelationshipGraph } from './world';
import { computeOpinion, opinionReasons } from './opinion';
import { computeMood, moodWord, moodReasons, pruneSelfThoughts } from './mood';
import { computeStanding, standingReasons, emptyReputation, standingOf } from './reputation';
import { chronicleYearly, renderLegend, eraTitle } from './chronicle';
import { directorYearly, directorDef, directorMood, initialDirector, DIRECTOR_OPTIONS } from './director';
import { figuresYearly, getFigure, houseById, computeHousePrestige } from './figures';
import { computeBelief, beliefReasons, coronationSlot } from './belief';
import { GATHERING_KINDS } from './gathering';
import { computeStatusBelief } from './statusBelief';
import { focusSettlement } from './lod';
import { getChildren } from './location';
import { setStoryteller } from './director';
import { renderEvent, renderEventParts } from './render';

export { setStoryteller } from './director';
import { speciesById, maturityOf, governmentById, leaderTitleOf, cultureById, deityById, patronDeityOf, ethicsTaboos, creedOf, natureOf, ambitionOf, RESOURCES, SUBSISTENCE_RESOURCE, worldviewReading, worldviewFromValues, CULTURES, type ValueAxis, intentLabel, intentById, NEEDS, NEED_FEELS, NEED_FEELS_GENERIC, NEED_BEAT_LOW, NEED_BEAT_HIGH } from './pack';
import { peopleName, voiceOf, kinOf, lexeme, LEXICON_SAMPLE, MODULES, featureName, setPack, setCulturesForSeed, PACK_ID, type UniversePack } from './pack';
import { personalityOf } from './social';
import { eventInterest, renderBackstory, PLAYER_VOICE } from './pack';
import { backstoryFacts } from './backstory';
import { PLAYER_ACTIONS } from './pack';
import { evaluateDecisions } from './decision';
import { buildAmbitionView } from './ambition';
import { createSettlements, promote, macroYearly, summaryYearly, migrationYearly, geographyYearly, economyYearly } from './lod';
import { travelTick } from './travel';
import { getOrganization, orgTitheYearly, treasuryOf, roleHistory, ROLE_LEADER, ROLE_FOUNDER } from './organization';
import { orgIntentYearly } from './orgReason';
import { orgInteractionYearly, playerRuledPolity, neighbourPolities, activeAgreement } from './orgInteraction';
import { warYearly, activeWarsOf } from './war';
import { orgActionYearly } from './orgAction';
import { needsDaily } from '../systems/needs';
import { actWeekly } from '../systems/social';
import { lifecycleYearly } from '../systems/lifecycle';
import { religionYearly, statePreceptsYearly } from './religion';
import { factionYearly, factionOf, civilWarYearly, exileYearly } from './factions';
import { reactToBeliefs } from './reactions';

export { focusSettlement } from './lod';
export { ensureFocusedVenues } from './venues';
export { possess, release, schedulePlayerIntent, inheritHeir, leaveFor } from './player';
import { schedulePlayerIntent, heirOf } from './player';

/**
 * Build a world. With `focus` (default) it materializes settlement 0 to full
 * fidelity — the normal play/UI flow. With `focus = false` it starts **headless /
 * all-aggregate** (no settlement focused, no live actors): the mode used to run
 * deep worldgen pre-history cheaply for centuries before a player enters. A
 * settlement is then promoted on demand with `focusSettlement`.
 */
export function createWorld(seed: number, focus = true, pack?: UniversePack): World {
  // bind the universe FIRST — every pack member the worldgen touches (species, cultures,
  // tongues, biomes…) must already speak this universe. Omitted = the built-in fantasy pack.
  if (pack) setPack(pack);
  // the fantasy pack's creeds are GENERATED per seed (content/cultureGen.ts) rather than the
  // same fixed 5 every time — aeon (and any other pack) keeps whatever static roster it
  // supplied above, since it never opted into this. Must run before any settlement/actor is
  // created, since founding, precepts, religion and toponymy all read CULTURES/DEITIES.
  if (PACK_ID === 'fantasy') setCulturesForSeed(seed);
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
    houseMeaning: new Map(),
    lifecycle: new Map(),
    needs: new Map(),
    selfThoughts: new Map(),
    traits: new Map(),
    personality: new Map(),
    profession: new Map(),
    ties: new Map(),
    memory: new Map(),
    reputation: new Map(),
    beliefs: new Map(),
    reactions: new Set(),
    newsFront: new Map(),
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
    currentIntent: new Map(),
    operationalState: new Map(),
    lastAction: new Map(),
    orgTreasury: new Map(),
    orgMandate: new Map(),
    orgAgreements: [],
    lastInteraction: new Map(),
    wars: [],
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
  // MODULES gates the genre-flavoured layers per the active pack (CLAUDE.md: packs choose
  // modules); core systems below always run.
  if (MODULES.travel) travelTick(world);
  const hasFocus = world.focusedSettlementId >= 0;
  // Full-fidelity systems only run when a settlement is focused. In headless /
  // worldgen mode there are no live actors, so the world advances purely by the
  // aggregate, geography, economy, director and chronicle passes below.
  // computed once per tick — shared by daily, weekly, and (on year-end days) yearly systems.
  const actors = hasFocus ? fullActors(world) : [];
  if (hasFocus) {
    needsDaily(world, actors);
    if (world.tick % 7 === 0) {
      actWeekly(world, actors);
      reactToBeliefs(world, actors); // actors act on what they've come to believe (Subjectivity 1B)
    }
  }
  if (world.tick % DAYS_PER_YEAR === 0) {
    if (hasFocus) lifecycleYearly(world, actors); // focused settlement, full fidelity
    if (hasFocus && MODULES.religion) religionYearly(world); // faith bonds, friction, conversion & apostasy
    if (hasFocus && MODULES.religion) statePreceptsYearly(world); // the creed judges how each soul LIVES (mood)
    if (hasFocus && MODULES.factions) factionYearly(world); // faction split recomputed before succession check
    macroYearly(world); // every other settlement, aggregate
    geographyYearly(world); // relations drift & raids along the region graph (declares wars)
    warYearly(world); // resolve formal wars: a fallen belligerent, or a long quiet, ends one
    economyYearly(world); // production, prices & goods trade along the routes
    orgTitheYearly(world); // polities draw their tithe (2C: OrgResources — funds the action layer)
    summaryYearly(world); // named people living elsewhere, coarse fidelity
    migrationYearly(world); // people move between settlements (geography-weighted)
    directorYearly(world); // the storyteller paces drama (fires incidents)
    figuresYearly(world); // rulers age, die, and are succeeded (the line of history)
    if (hasFocus && MODULES.factions) civilWarYearly(world); // resolve civil wars after the grace period
    if (hasFocus && MODULES.factions) exileYearly(world);   // formal return of exiles after EXILE_RETURN_YEARS
    orgIntentYearly(world); // organizations form their collective intent (Perception→Worldview→Intent)
    orgInteractionYearly(world); // ...address proposals to their neighbours (Proposal→Evaluation→Outcome)
    orgActionYearly(world); // ...and execute a bounded domestic action (Intent→Action→Outcome→History)
    if (hasFocus) pruneRelationshipGraph(world); // drop expired, non-milestone acquaintances
    if (hasFocus) for (const id of actors) pruneSelfThoughts(world, id); // bound mood memory
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

/** Is the possessed actor alive? (False when nobody is possessed.) Used by the worker's
 *  streaming advance to HOLD TIME the year the player's life ends (time flow). */
export function isPlayerAlive(world: World): boolean {
  return world.playerId !== undefined && world.lifecycle.get(world.playerId)?.alive === true;
}

/** The ids of the framed choices the world is presenting the player right now (empty when
 *  none / nobody possessed). The streaming advance compares these against its baseline so
 *  only a decision that APPEARS mid-advance holds time — one already on the table when the
 *  player pressed play must not stall every single year. Pure read. */
export function pendingDecisionIds(world: World): string[] {
  const id = world.playerId;
  if (id === undefined || !world.lifecycle.get(id)?.alive) return [];
  return evaluateDecisions(world, id).map((d) => d.id);
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
    houseId: world.houses.find((h) => h.name === idn.family)?.id, // link to the dynasty, if any
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
    houseId: fig.houseId,
    backstory: backstoryFor(world, id), // present for crowned actors; absent for minted records
    lifeEvents,
  };
}

/** Inspect a HOUSE (dynasty): its founder, seat, the line of members who held power, and its
 *  saga — assembled from the House record + its members' events. */
export function inspectHouse(world: World, id: number): HouseDetail | undefined {
  const house = world.houses.find((h) => h.id === id);
  if (!house) return undefined;
  const founderFig = getFigure(world, house.founderId);
  // the line: figures of this House, deduped by id (a re-crowned actor leaves duplicate records),
  // sorted by when they came to prominence.
  const seenM = new Set<number>();
  const memberFigs = world.figures
    .filter((f) => f.houseId === id && !seenM.has(f.id) && seenM.add(f.id))
    .sort((a, b) => a.reignStart - b.reignStart)
    .slice(0, 20);
  const memberIds = new Set(memberFigs.map((f) => f.id));
  // the living head of the line: while the House holds a seat, its latest-reigning member still alive.
  const headId =
    house.seatSettlementId !== undefined
      ? [...memberFigs].filter((f) => f.deathYear === undefined).sort((a, b) => b.reignStart - a.reignStart)[0]?.id
      : undefined;
  const members = memberFigs.map((f) => {
    const t = world.ties.get(f.id);
    // spouses resolved to figures (any House) so they can be named/linked — genealogy needs marriages.
    const spouses = (t?.spouses ?? []).flatMap((sid) => {
      const sf = world.figuresById.get(sid);
      return sf ? [{ id: sf.id, name: sf.name, houseId: sf.houseId, houseName: houseById(world, sf.houseId)?.name }] : [];
    });
    return {
      name: f.name,
      id: f.id,
      role: f.role,
      bornYear: f.bornYear,
      deathYear: f.deathYear,
      reignStart: f.reignStart,
      reignEnd: f.reignEnd,
      isFounder: f.id === house.founderId,
      isSeat: f.id === headId,
      parentIds: (t?.parents ?? []).filter((p) => memberIds.has(p)), // edges up, within the House
      childIds: (t?.children ?? []).filter((c) => memberIds.has(c)), // edges down, within the House
      spouses,
    };
  });
  // the House's saga: its members' events + anything naming the House, notable-first-then-chrono.
  const evIds = new Set<number>();
  for (const m of members) for (const e of world.eventsBySubject.get(m.id) ?? []) evIds.add(e);
  const events = [...evIds]
    .map((eid) => getEvent(world, eid))
    .filter((ev): ev is WorldEvent => ev !== undefined)
    .sort((a, b) => b.year - a.year)
    .slice(0, 24)
    .map((ev) => eventView(world, ev));
  return {
    id: house.id,
    name: house.name,
    meaning: world.houseMeaning.get(house.name),
    foundedYear: house.foundedYear,
    extinctYear: house.extinctYear,
    prestige: Math.round(computeHousePrestige(house, world.tick)),
    origin: world.settlements[house.originSettlementId]?.name,
    originId: house.originSettlementId,
    seat: house.seatSettlementId !== undefined ? world.settlements[house.seatSettlementId]?.name : undefined,
    seatId: house.seatSettlementId,
    founder: founderFig ? { name: founderFig.name, id: founderFig.id } : undefined,
    members,
    events,
  };
}

/** Inspect a CULTURE/creed: what it holds dear, its moral character, its god, its tongue, and
 *  the living settlements that keep it. Pure read of pack data + world state. */
export function inspectCulture(world: World, id: string): CultureDetail | undefined {
  const c = cultureById(id);
  if (c.id !== id) return undefined; // cultureById falls back to CULTURES[0]; reject an unknown id
  const deity = patronDeityOf(id);
  return {
    id,
    name: c.name,
    leanings: worldviewReading(worldviewFromValues(c.values as Record<ValueAxis, number>)),
    creed: creedOf(id),
    patronDeity: deity ? { name: deity.name, id: deity.id, domain: deity.domain } : undefined,
    tongue: { demonym: peopleName(id, world.seed), voice: voiceOf(id) },
    settlements: world.settlements
      .filter((s) => s.ruinedYear === undefined && s.cultureId === id)
      .map((s) => ({ name: s.name, id: s.id })),
  };
}

/** Inspect a DEITY: its domain, the creeds whose patron it is, and how many souls hold its
 *  faith right now. */
export function inspectDeity(world: World, id: string): DeityDetail | undefined {
  const d = deityById(id);
  if (d.id !== id) return undefined; // deityById falls back; reject an unknown id
  let faithful = 0;
  for (const f of world.faith.values()) if (f === id) faithful++;
  return {
    id,
    name: d.name,
    domain: d.domain,
    cultures: CULTURES.filter((c) => c.patronDeityId === id).map((c) => ({ name: c.name, id: c.id })),
    faithful,
  };
}

/** Inspect a named geographic FEATURE (a sea, range, great river, lake): its name in the old
 *  tongue and the living towns that sit beside it. Surface worlds only. */
export function inspectFeature(world: World, index: number): FeatureDetail | undefined {
  const sub = world.substrate;
  if (!(sub instanceof SurfaceSubstrate)) return undefined;
  const feature = sub.geography.features.find((f) => f.index === index);
  if (!feature) return undefined;
  const named = featureName(world.seed, feature);
  return {
    index,
    name: named.name,
    meaning: named.meaning,
    kind: feature.kind,
    settlements: world.settlements
      .filter((s) => s.ruinedYear === undefined && s.landmark?.featureIndex === index)
      .map((s) => ({ name: s.name, id: s.id })),
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

  // OUTGOING DIPLOMACY (2E): if the player rules a polity and this settlement is a
  // neighbouring polity's seat, offer the pacts not already in force. The neighbour's own
  // bounded view decides any proposal (propose_pact → resolveProposal).
  let diplomacy: SettlementDetail['diplomacy'];
  const ruledId = playerRuledPolity(world);
  if (ruledId !== undefined && s.polityId !== undefined && s.polityId !== ruledId && s.ruinedYear === undefined) {
    const ruledOrg = getOrganization(world, ruledId);
    const other = getOrganization(world, s.polityId);
    if (ruledOrg && other && other.dissolvedYear === undefined && neighbourPolities(world, ruledOrg).some((o) => o.id === other.id)) {
      diplomacy = {
        otherName: other.name,
        canTrade: activeAgreement(world, 'trade_agreement', ruledId, other.id) === undefined,
        canPeace: activeAgreement(world, 'non_aggression', ruledId, other.id) === undefined,
        canAlly: activeAgreement(world, 'alliance', ruledId, other.id) === undefined,
      };
    }
  }
  return { settlementId: id, events, ...(diplomacy ? { diplomacy } : {}) };
}

/**
 * Inspect a VENUE (design/25) — a public Location made a first-class, traceable thing:
 * what it is, and everything recorded to have happened there. Events are found by
 * their `venueId` data over the recent window and the archive (venues are new enough
 * that no reverse index is warranted yet; revisit if venue histories grow long).
 */
export function inspectVenue(world: World, id: number): VenueDetail | undefined {
  const loc = world.locations.get(id);
  if (!loc || loc.parentId === undefined) return undefined;
  const s = world.settlements[loc.parentId];
  if (!s) return undefined;
  const here: WorldEvent[] = [];
  for (const ev of world.events) if (ev.data.venueId === id) here.push(ev);
  for (const ev of world.eventArchive.values()) if (ev.data.venueId === id) here.push(ev);
  here.sort((a, b) => b.id - a.id); // newest first
  return {
    id,
    name: loc.name,
    meaning: loc.nameMeaning,
    type: loc.locationType,
    settlementId: s.id,
    settlement: s.name,
    foundedYear: loc.foundedYear ?? s.foundedYear,
    events: here.slice(0, 40).map((ev) => eventView(world, ev)),
  };
}

/** The settlement's public venues, for the close view (its buildings link to them). */
export function localVenues(world: World, id: SettlementId): { id: number; name: string; meaning?: string; type: string }[] {
  const s = world.settlements[id];
  if (!s) return [];
  return getChildren(world, id).map((l) => ({ id: l.id, name: l.name, meaning: l.nameMeaning, type: l.locationType }));
}

/**
 * The notable events of ONE settlement's recorded history, oldest first — the raw
 * material the close view's HISTORY MARKS are stamped from (design/24 §3.4: a burned
 * quarter for a raid, a stone for a famine, a monument for a wonder). Read-only, same
 * event union as inspectSettlement; filtered by INTEREST (engine-generic — which TYPES
 * become marks is the pack's call, since the type vocabulary is pack data).
 */
const LOCAL_CHRONICLE_FLOOR = 20; // below this an event is routine, never a mark
const LOCAL_CHRONICLE_CAP = 80;
export function buildLocalChronicle(world: World, id: SettlementId): EventView[] {
  const s = world.settlements[id];
  if (!s) return [];
  const eventIds = new Set<number>(world.eventsBySettlement.get(id) ?? []);
  for (const fid of world.figuresBySettlement.get(id) ?? []) {
    for (const eid of world.eventsBySubject.get(fid) ?? []) eventIds.add(eid);
  }
  return [...eventIds]
    .sort((a, b) => a - b) // event ids are monotonic — ascending = oldest first
    .map((eid) => getEvent(world, eid))
    .filter((ev): ev is WorldEvent => ev !== undefined && eventInterest(ev.type, ev.data) >= LOCAL_CHRONICLE_FLOOR)
    .slice(-LOCAL_CHRONICLE_CAP) // the most recent notable N (history marks fade anyway)
    .map((ev) => eventView(world, ev));
}

/** A GATHERING still fresh enough to draw — this settlement's own crowd (design/27 §4),
 *  read for the close view's ambient-life pass (design/28 §4.3: render what already
 *  happens, not new state). Unlike buildLocalChronicle this ISN'T filtered by interest —
 *  a modest wedding still gathers a crowd, it just never earns a permanent history mark —
 *  only by recency: a gathering is a moment, not a monument, so only THIS YEAR'S count.
 *  A pure read: no rng, no mutation, nothing stored. */
export interface LocalGathering { kind: string; venueId?: number; year: number }
export function recentGatherings(world: World, id: SettlementId): LocalGathering[] {
  const year = Math.floor(world.tick / DAYS_PER_YEAR);
  const out: LocalGathering[] = [];
  for (const eid of world.eventsBySettlement.get(id) ?? []) {
    const ev = getEvent(world, eid);
    if (!ev || ev.year !== year || !GATHERING_KINDS.has(ev.type)) continue;
    out.push({ kind: ev.type, venueId: typeof ev.data.venueId === 'number' ? ev.data.venueId : undefined, year: ev.year });
  }
  return out;
}

/**
 * WHO LIVES UNDER ONE ROOF (design/24 L2) — the focused settlement's full actors,
 * grouped into households purely from the ties the sim already keeps: wedded couples
 * share a hearth, the unwed live under their parents' roof, the rest keep their own.
 * A pure READING of world state — no rng, no mutation, nothing stored — so the same
 * ties always yield the same households, and a wedding re-houses a couple correctly.
 * Only the focused settlement is lived in full; anywhere else returns [].
 */
export function buildHouseholds(world: World, id: SettlementId): HouseholdView[] {
  if (world.focusedSettlementId !== id) return [];
  const locals = fullActors(world).filter((a) => world.lifecycle.get(a)?.alive);
  const localSet = new Set(locals);
  const households: EntityId[][] = [];
  const homeOf = new Map<EntityId, number>(); // actor → household index
  const place = (aid: EntityId, h: number) => {
    households[h].push(aid);
    homeOf.set(aid, h);
  };

  // PASS A — wedded couples found households (ascending id: deterministic)
  for (const aid of locals) {
    if (homeOf.has(aid)) continue;
    const spouses = (world.ties.get(aid)?.spouses ?? []).filter((s) => localSet.has(s) && !homeOf.has(s));
    if (spouses.length === 0) continue;
    const h = households.push([]) - 1;
    place(aid, h);
    for (const s of spouses) place(s, h);
  }
  // PASS B — the unwed with NO living local parent keep their own roof. This runs
  // before the join pass so an unwed parent's own household exists for their children
  // to join (a widowed mother and her children share one hearth, not three).
  for (const aid of locals) {
    if (homeOf.has(aid)) continue;
    const hasLocalParent = (world.ties.get(aid)?.parents ?? []).some((p) => localSet.has(p));
    if (hasLocalParent) continue;
    const h = households.push([]) - 1;
    place(aid, h);
  }
  // PASS C — the unwed join a parent's hearth (iterate to fixpoint so a grandchild
  // follows its parent in; parent-child ties are acyclic, so every chain ends at a
  // pass-A couple or a pass-B root and the fixpoint houses everyone)
  let moved = true;
  while (moved) {
    moved = false;
    for (const aid of locals) {
      if (homeOf.has(aid)) continue;
      const parents = (world.ties.get(aid)?.parents ?? []).filter((p) => homeOf.has(p)).sort((a, b) => a - b);
      if (parents.length === 0) continue;
      place(aid, homeOf.get(parents[0])!);
      moved = true;
    }
  }
  // PASS D — anyone still unhoused (every local parent is dead/away and unhoused ties
  // couldn't resolve) keeps their own roof
  for (const aid of locals) {
    if (homeOf.has(aid)) continue;
    const h = households.push([]) - 1;
    place(aid, h);
  }

  return households.map((members) => {
    // the eldest is the head of the household; their surname names it
    const byAge = [...members].sort(
      (a, b) => (world.lifecycle.get(b)?.ageYears ?? 0) - (world.lifecycle.get(a)?.ageYears ?? 0) || a - b,
    );
    const head = byAge[0];
    const headSpouses = new Set(world.ties.get(head)?.spouses ?? []);
    const view = (aid: EntityId): HouseholdMember => ({
      id: aid,
      name: fullName(world, aid),
      role: aid === head ? 'head' : headSpouses.has(aid) ? 'spouse' : 'child',
      ageYears: world.lifecycle.get(aid)?.ageYears ?? 0,
      profession: world.profession.get(aid) ?? '',
    });
    const ordered = [head, ...byAge.filter((m) => m !== head && headSpouses.has(m)), ...byAge.filter((m) => m !== head && !headSpouses.has(m))];
    return { family: world.identity.get(head)?.family ?? '?', members: ordered.map(view) };
  });
}

/**
 * A tiny at-a-glance card for a HOVERED entity link — who/what something is in a line
 * or three, without the cost (or the commitment) of a full inspection. Deliberately
 * much lighter than the *Detail builders: no event scans, no relationship walks.
 */
export function buildPeek(world: World, ref: EventRef): PeekCard | undefined {
  switch (ref.kind) {
    case 'actor': {
      if (!world.identity.has(ref.id)) return undefined;
      const a = actorView(world, ref.id);
      return {
        kind: 'actor',
        name: a.name,
        lines: [
          `${a.species} ${a.profession} · ${a.ageYears}y${a.alive ? '' : ` · died y${a.deathYear}`}`,
          `of House ${a.house} · ${a.nature}`,
        ],
        houseId: a.houseId,
        houseName: a.house,
        dead: !a.alive,
      };
    }
    case 'figure': {
      const fig = world.figuresById.get(ref.id);
      if (!fig) return undefined;
      const house = houseById(world, fig.houseId);
      return {
        kind: 'figure',
        name: fig.name,
        lines: [
          `${fig.role} of ${world.settlements[fig.settlementId]?.name ?? '?'}`,
          `b.y${fig.bornYear}${fig.deathYear !== undefined ? `–y${fig.deathYear}` : ''} · ${fig.deathYear !== undefined ? `r.y${fig.reignStart}–y${fig.reignEnd ?? fig.deathYear}` : `reigning since y${fig.reignStart}`}`,
        ],
        houseId: fig.houseId,
        houseName: house?.name,
        dead: fig.deathYear !== undefined,
      };
    }
    case 'house': {
      const house = world.houses.find((h) => h.id === ref.id);
      if (!house) return undefined;
      const meaning = world.houseMeaning.get(house.name);
      const seat = house.seatSettlementId !== undefined ? world.settlements[house.seatSettlementId]?.name : undefined;
      return {
        kind: 'house',
        name: `House ${house.name}`,
        lines: [
          `${meaning ? `“${meaning}” · ` : ''}founded y${house.foundedYear} · ${Math.round(computeHousePrestige(house, world.tick))} renown`,
          house.extinctYear !== undefined ? `fallen, y${house.extinctYear}` : seat ? `rules ${seat}` : 'out of power',
        ],
        houseId: house.id,
        houseName: house.name,
        dead: house.extinctYear !== undefined,
      };
    }
    case 'settlement': {
      const s = world.settlements[ref.id];
      if (!s) return undefined;
      const pop = s.detailed ? fullActors(world).length : s.macro.population;
      return {
        kind: 'settlement',
        name: s.name,
        lines: [
          s.ruinedYear !== undefined
            ? `a ruin · fell y${s.ruinedYear}`
            : `${pop.toLocaleString()} souls · ${cultureById(s.cultureId).name}`,
          `founded y${s.foundedYear}`,
        ],
        dead: s.ruinedYear !== undefined,
      };
    }
    case 'culture': {
      const c = cultureById(ref.id);
      if (c.id !== ref.id) return undefined;
      const towns = world.settlements.filter((s) => s.ruinedYear === undefined && s.cultureId === ref.id).length;
      return {
        kind: 'culture',
        name: c.name,
        lines: [
          worldviewReading(worldviewFromValues(c.values as Record<ValueAxis, number>)),
          `${towns} living ${towns === 1 ? 'town' : 'towns'}`,
        ],
      };
    }
    case 'deity': {
      const d = deityById(ref.id);
      if (d.id !== ref.id) return undefined;
      let faithful = 0;
      for (const f of world.faith.values()) if (f === ref.id) faithful++;
      return { kind: 'deity', name: d.name, lines: [`god of ${d.domain}`, `${faithful} faithful`] };
    }
    case 'feature': {
      const sub = world.substrate;
      if (!(sub instanceof SurfaceSubstrate)) return undefined;
      const feature = sub.geography.features.find((f) => f.index === ref.id);
      if (!feature) return undefined;
      const named = featureName(world.seed, feature);
      return {
        kind: 'feature',
        name: named.name,
        lines: [`a ${feature.kind === 'range' ? 'mountain range' : feature.kind}${named.meaning ? ` · “${named.meaning}”` : ''}`],
      };
    }
    case 'venue': {
      const loc = world.locations.get(ref.id);
      if (!loc || loc.parentId === undefined) return undefined;
      const s = world.settlements[loc.parentId];
      return {
        kind: 'venue',
        name: loc.name,
        lines: [
          `${loc.nameMeaning ? `“${loc.nameMeaning}” · ` : ''}a ${loc.locationType} in ${s?.name ?? '?'}`,
          `raised y${loc.foundedYear ?? '?'}`,
        ],
      };
    }
  }
}

/** Build the legible reasoning view from an org's stored decision — stable factor/fact ids
 *  resolved to display text. Undefined until the org has reasoned (first yearly tick). */
function orgReasoningView(world: World, orgId: OrgId): OrgIntentView | undefined {
  const decision = world.currentIntent.get(orgId);
  if (!decision) return undefined;
  const humanize = (id: string) => id.replace(/_/g, ' ');
  return {
    worldview: worldviewReading(decision.worldview),
    intent: intentLabel(decision.kind),
    intentDescription: intentById(decision.kind)?.description ?? '',
    score: Math.round(decision.score),
    factors: decision.factors.map((f) => ({ label: humanize(f.id), value: f.value, group: f.group })),
    alternatives: decision.alternatives
      .filter((a) => a.kind !== decision.kind)
      .sort((x, y) => y.score - x.score)
      .map((a) => ({ label: intentLabel(a.kind), score: Math.round(a.score) })),
    perception: decision.perception.map((p) => ({ label: humanize(p.id), value: p.value, confidence: p.confidence })),
  };
}

function settlementView(world: World, fullCount: number, summariesByHome: Map<number, string[]>): SettlementView[] {
  return world.settlements.map((s) => {
    const pop = s.detailed ? fullCount : s.macro.population;
    return {
      id: s.id,
      name: s.name,
      nameMeaning: s.nameMeaning,
      landmark: s.landmark,
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
      cultureId: s.cultureId,
      culturalTaboos: ethicsTaboos(s.cultureId),
      creed: creedOf(s.cultureId),
      patronDeity: (({ name, domain, id }) => ({ name, domain, id }))(patronDeityOf(s.cultureId)),
      founder: s.founderName,
      ruler: getFigure(world, s.currentRulerId)?.name,
      rulerId: getFigure(world, s.currentRulerId) ? s.currentRulerId : undefined,
      polity: (() => {
        const org = getOrganization(world, s.polityId);
        if (!org) return undefined;
        const founder = roleHistory(world, org.id, ROLE_FOUNDER)[0];
        return {
          name: org.name,
          subtype: org.subtype,
          leaderName: getFigure(world, org.leaderId)?.name,
          leaderId: getFigure(world, org.leaderId) ? org.leaderId : undefined,
          founderName: founder ? getFigure(world, founder.actorId)?.name : undefined,
          founderId: founder && getFigure(world, founder.actorId) ? founder.actorId : undefined,
          leaderCount: roleHistory(world, org.id, ROLE_LEADER).length,
          standing: Math.round(computeStanding(world.reputation.get(org.id) ?? emptyReputation(), world.tick)),
          treasury: Math.round(treasuryOf(world, org.id)),
          // the focused polity's current reasoning, made legible (the 2C deliverable)
          reasoning: s.id === world.focusedSettlementId ? orgReasoningView(world, org.id) : undefined,
          operational: (() => {
            const ops = world.operationalState.get(org.id);
            return ops ? { ...ops } : undefined;
          })(),
          lastAction: (() => {
            const la = world.lastAction.get(org.id);
            return la ? { summary: la.summary, outcome: la.outcome, year: Math.floor(la.sinceTick / DAYS_PER_YEAR) } : undefined;
          })(),
          agreements: world.orgAgreements
            .filter((g) => g.expiresTick > world.tick && (g.a === org.id || g.b === org.id))
            .map((g) => ({
              kind: g.kind,
              with: getOrganization(world, g.a === org.id ? g.b : g.a)?.name ?? 'a fallen power',
              untilYear: Math.floor(g.expiresTick / DAYS_PER_YEAR),
            })),
          lastInteraction: (() => {
            const li = world.lastInteraction.get(org.id);
            return li ? { summary: li.summary, year: Math.floor(li.sinceTick / DAYS_PER_YEAR) } : undefined;
          })(),
          wars: activeWarsOf(world, org.id).map((wr) => {
            const onA = wr.sideA.includes(org.id);
            const ourSide = onA ? wr.sideA : wr.sideB;
            const foePrimary = onA ? wr.sideB[0] : wr.sideA[0];
            return {
              against: getOrganization(world, foePrimary)?.name ?? 'a fallen power',
              alliesCount: ourSide.length - 1, // co-belligerents fighting alongside us
              sinceYear: Math.floor(wr.startTick / DAYS_PER_YEAR),
            };
          }),
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
/**
 * The player's life as a linked, chronological story. Two threads woven together: the player's own
 * recorded life events, and the deaths of KIN they have come to believe — each loss annotated with
 * how the news reached them. That annotation is the seam where belief explains behaviour: today a
 * witnessed death reads "you were there"; once news travels, a distant one will read "word reached
 * you 19 days later", and the player will have lived inside the epistemic layer without inspecting it.
 */
function buildPlayerStory(world: World, id: EntityId): StoryBeat[] {
  const beats: { tick: number; beat: StoryBeat }[] = [];
  const RELATIONSHIP_EVENTS = new Set(['married', 'feud', 'rivalry', 'friendship']); // told first-person below

  // 1) the player's own recorded life events (born, ascension, a goal met, a brawl…)
  for (const eid of world.eventsBySubject.get(id) ?? []) {
    const ev = getEvent(world, eid);
    if (!ev || RELATIONSHIP_EVENTS.has(ev.type)) continue;
    beats.push({ tick: ev.tick, beat: { year: ev.year, parts: renderEventParts(world, ev), tone: ev.type } });
  }

  // 2) losses: kin the player has come to believe are dead — annotated with HOW they learned.
  //    (Today a witnessed death reads "you were there"; once news travels, a distant one will read
  //    "word reached you 19 days later" — belief explaining the player's behaviour, not inspected.)
  for (const b of world.beliefs.get(id) ?? []) {
    if (b.assertion !== 'dead' || !isKin(world, id, b.subject)) continue;
    const cause = b.evidence[0]?.cause;
    const deathEv = cause !== undefined ? getEvent(world, cause) : undefined;
    if (!deathEv) continue;
    const learnedTick = b.evidence[0]?.sinceTick ?? deathEv.tick;
    const delay = Math.max(0, learnedTick - deathEv.tick);
    const note = delay === 0 ? PLAYER_VOICE.story.witnessed : PLAYER_VOICE.story.newsDelay(delay);
    beats.push({ tick: learnedTick, beat: { year: Math.floor(learnedTick / DAYS_PER_YEAR), parts: renderEventParts(world, deathEv), tone: 'died', note } });
  }

  // 3) relationship milestones — who came to matter, and when. First-person, always available (a
  //    promoted actor's marriage may predate any recorded event, but the bond itself is there).
  const BOND = PLAYER_VOICE.story.bond; // the words are pack voice; the thresholds are engine law
  for (const [other, edge] of world.rels.get(id) ?? []) {
    const f = edge.flags;
    const op = computeOpinion(edge, world.tick);
    let phrase: { pre: string; post: string } | undefined;
    let tone = 'friendship';
    if (f.spouse) { phrase = BOND.spouse; tone = 'married'; }
    else if (f.feud) { phrase = BOND.feud; tone = 'feud'; }
    else if (f.rival) { phrase = BOND.rival; tone = 'rivalry'; }
    else if (f.friend) { phrase = BOND.friend; tone = 'friendship'; }
    else if (op >= 400) { phrase = BOND.fond; tone = 'friendship'; }
    else if (op <= -400) { phrase = BOND.resent; tone = 'rivalry'; }
    if (!phrase) continue;
    beats.push({
      tick: edge.sinceTick,
      beat: {
        year: Math.floor(edge.sinceTick / DAYS_PER_YEAR),
        parts: [{ text: phrase.pre }, { text: fullName(world, other), ref: { kind: 'actor', id: other } }, { text: phrase.post }],
        tone,
      },
    });
  }

  beats.sort((a, b) => a.tick - b.tick); // a life told from its beginning
  return beats.slice(-40).map((x) => x.beat);
}

/**
 * WHAT'S HAPPENING — the live, unresolved threads the player can anticipate. Present tense, and it
 * changes every tick: bonds warming toward friendship or souring toward enmity, a need slipping
 * toward crisis, and — the anticipation hook that only MythOS has — word on the road that the
 * player does not yet know (read straight off the objective news frontier). This is what makes
 * "Advance a week" a thing you *want* to press.
 */
function buildPlayerTensions(world: World, id: EntityId): Tension[] {
  const t: Tension[] = [];
  const tick = world.tick;

  // bonds not yet resolved into a flag — will they become friendship? enmity? (as story, not value)
  for (const [other, edge] of world.rels.get(id) ?? []) {
    const f = edge.flags;
    if (f.spouse || f.feud || f.friend || f.rival) continue;
    const op = computeOpinion(edge, tick);
    const name = fullName(world, other);
    if (op >= 300) t.push({ icon: '💞', text: PLAYER_VOICE.tension.warming(name), ref: { kind: 'actor', id: other } });
    else if (op <= -300) t.push({ icon: '💢', text: PLAYER_VOICE.tension.souring(name), ref: { kind: 'actor', id: other } });
  }

  // word on the road — as EXPECTATION, not an audit line (the player is waiting, not measuring)
  const home = world.homeSettlement.get(id);
  if (home !== undefined) {
    let soonest: { subj: number; arrival: number } | undefined;
    for (const [key, val] of world.newsFront) {
      if (!key.startsWith(`${home}:ruler:`) || val.arrival <= tick) continue;
      if (!soonest || val.arrival < soonest.arrival) soonest = { subj: Number(key.split(':')[2]), arrival: val.arrival };
    }
    if (soonest) {
      t.push({ icon: '📨', text: PLAYER_VOICE.tension.awaitingNews(world.settlements[soonest.subj]?.name, soonest.arrival - tick) });
    }
  }

  return t.slice(0, 5);
}

/** OPPORTUNITIES — openings the world is presenting, derived from state. Not quests: just "if you
 *  wanted to do something interesting right now, here is what's open to you." */
function buildPlayerOpportunities(world: World, id: EntityId, actors: EntityId[]): Tension[] {
  const o: Tension[] = [];

  // an unwed player has courtship prospects — surface the one they already like most
  if (!world.ties.get(id)?.spouses.length) {
    let best: EntityId | undefined;
    let bestOp = -1;
    for (const other of actors) {
      if (other === id || isKin(world, id, other)) continue;
      if (world.lifecycle.get(other)!.ageYears < maturityOf(world.identity.get(other)!.speciesId)) continue;
      if (world.ties.get(other)?.spouses.length) continue;
      const edge = world.rels.get(id)?.get(other);
      const op = edge ? computeOpinion(edge, world.tick) : 0;
      if (op > bestOp) { bestOp = op; best = other; }
    }
    if (best !== undefined) o.push({ icon: '💍', text: PLAYER_VOICE.opportunity.court(fullName(world, best)), ref: { kind: 'actor', id: best } });
  }

  // a warm bond on the cusp of true friendship
  for (const [other, edge] of world.rels.get(id) ?? []) {
    if (edge.flags.friend || edge.flags.spouse) continue;
    if (computeOpinion(edge, world.tick) >= 450) {
      o.push({ icon: '🤝', text: PLAYER_VOICE.opportunity.befriend(fullName(world, other)), ref: { kind: 'actor', id: other } });
      break;
    }
  }

  return o.slice(0, 4);
}

/** THREATS — narrative worries (not health bars), derived from state: an enemy, a failing need,
 *  a divided town, the weight of years. What the player should be afraid of. */
function buildPlayerThreats(world: World, id: EntityId): Tension[] {
  const th: Tension[] = [];

  // the one who wishes you most ill: an open feud always outranks mere dislike;
  // within a tier, the lowest opinion wins (so "bitterest" really is the bitterest)
  let foe: EntityId | undefined;
  let foeOp = Infinity;
  let foeFeud = false;
  for (const [other, edge] of world.rels.get(id) ?? []) {
    const op = computeOpinion(edge, world.tick);
    const feud = !!edge.flags.feud;
    if ((feud && !foeFeud) || (feud === foeFeud && op < foeOp)) { foe = other; foeOp = op; foeFeud = feud; }
  }
  if (foe !== undefined && (foeFeud || foeOp < -300)) th.push({ icon: '⚔', text: PLAYER_VOICE.threat.grudge(fullName(world, foe)), ref: { kind: 'actor', id: foe } });

  // a need slipping toward crisis
  const needs = world.needs.get(id);
  if (needs) {
    let lowKey: string | undefined;
    let lowVal = 260;
    for (const [k, v] of Object.entries(needs)) if (v < lowVal) { lowVal = v; lowKey = k; }
    if (lowKey) th.push({ icon: '⚠', text: PLAYER_VOICE.threat.needLow(lowKey) });
  }

  // your town divided (the focused settlement's faction split)
  const home = world.homeSettlement.get(id);
  if (world.factionSplit && home === world.focusedSettlementId) {
    th.push({ icon: '⚠', text: PLAYER_VOICE.threat.divided(world.settlements[home]?.name) });
  }

  // the weight of years
  const lc = world.lifecycle.get(id);
  const sp = speciesById(world.identity.get(id)!.speciesId);
  if (lc && sp.lifespan && lc.ageYears >= sp.lifespan * 0.85) {
    th.push({ icon: '⏳', text: PLAYER_VOICE.threat.aging });
  }

  return th.slice(0, 4);
}

/** PEOPLE WHO MATTER — a tiny cast of anchors, each with a live one-line STATUS so a name reads as
 *  a character: spouse, the one you're courting, your closest ally, your bitterest rival, your ruler. */
function buildPlayerCast(world: World, id: EntityId): CastMember[] {
  const cast: CastMember[] = [];
  const seen = new Set<number>();
  const add = (icon: string, role: string, other: number | undefined, note: string, status: string, kind: 'actor' | 'figure' = 'actor') => {
    if (other === undefined || other === id || seen.has(other)) return;
    seen.add(other);
    cast.push({ icon, role, status, kind, id: other, name: kind === 'figure' ? getFigure(world, other)?.name ?? fullName(world, other) : fullName(world, other), note });
  };
  // your feeling toward someone, as a word — the pack's five-band ladder, warmest first
  const VOICE = PLAYER_VOICE.cast;
  const mood = (op: number) => VOICE.moodWords[op > 600 ? 0 : op > 200 ? 1 : op > -100 ? 2 : op > -500 ? 3 : 4];

  const ties = world.ties.get(id);
  if (ties?.spouses.length) {
    const sp = ties.spouses[0];
    const edge = world.rels.get(id)?.get(sp);
    add('❤️', 'spouse', sp, VOICE.spouseNote, edge ? mood(computeOpinion(edge, world.tick)) : VOICE.spouseNote);
  }

  const asp = currentAspiration(world, id);
  if (asp.kind === 'partner' && asp.target !== undefined) {
    const edge = world.rels.get(id)?.get(asp.target);
    const op = edge ? computeOpinion(edge, world.tick) : 0;
    add('💍', 'courting', asp.target, VOICE.courtingNote, op >= 250 ? VOICE.courtingWarming : VOICE.courtingCold);
  }

  // closest ally and bitterest rival: a declared bond (friend / feud-or-rival) always
  // outranks raw opinion; within a tier, the strongest opinion wins.
  let ally: number | undefined, allyOp = -Infinity, allyBond = false;
  let foe: number | undefined, foeOp = Infinity, foeBond = false;
  for (const [other, edge] of world.rels.get(id) ?? []) {
    if (edge.flags.spouse) continue;
    const op = computeOpinion(edge, world.tick);
    const friend = !!edge.flags.friend;
    if ((friend && !allyBond) || (friend === allyBond && op > allyOp)) { ally = other; allyOp = op; allyBond = friend; }
    const hostile = !!(edge.flags.feud || edge.flags.rival);
    if ((hostile && !foeBond) || (hostile === foeBond && op < foeOp)) { foe = other; foeOp = op; foeBond = hostile; }
  }
  if (!allyBond && allyOp <= 150) ally = undefined; // mere acquaintances aren't allies
  if (!foeBond && foeOp >= -150) foe = undefined; // ...nor mild dislike a rival
  add('🤝', 'ally', ally, VOICE.allyNote, allyOp > 600 ? VOICE.allySteadfast : VOICE.allyNote);
  add('⚔', 'rival', foe, VOICE.rivalNote, foeOp < -600 ? VOICE.rivalHostile : VOICE.rivalCold);

  const home = world.homeSettlement.get(id);
  const rulerId = home !== undefined ? world.settlements[home]?.currentRulerId : undefined;
  if (rulerId !== undefined) {
    const fig = getFigure(world, rulerId);
    const reign = fig ? Math.floor(world.tick / DAYS_PER_YEAR) - fig.reignStart : 0;
    add('👑', 'ruler', rulerId, VOICE.rulerNote, reign >= 20 ? VOICE.rulerLongReigning : reign <= 3 ? VOICE.rulerNewlyRisen : VOICE.rulerSeated, 'figure');
  }

  return cast.slice(0, 6);
}

/**
 * WHAT YOU BELIEVE — the player's own subjective reality, the payoff of the whole epistemic layer.
 * Who they believe rules (which will one day lag reality when a distant coronation's news is slow),
 * the losses they have come to know, and — pointedly — what they do NOT yet know. The player now
 * inhabits a subjective world exactly like every NPC, rather than reading the objective one.
 */
function buildPlayerBeliefs(world: World, id: EntityId): Tension[] {
  const b: Tension[] = [];
  const home = world.homeSettlement.get(id);

  // who you believe rules your own place (an explicit belief if you hold one; else the ruler you
  // live under — you know your own sovereign, whatever the distant world has since done)
  if (home !== undefined) {
    const sb = computeStatusBelief(world, id, coronationSlot(home));
    const rulerId = sb.occupant ?? world.settlements[home]?.currentRulerId;
    const name = rulerId !== undefined ? getFigure(world, rulerId)?.name ?? fullName(world, rulerId) : undefined;
    // stated as the character's own truth, not "you believe" — this is "what you KNOW" (design/21)
    if (name) b.push({ icon: '👑', text: PLAYER_VOICE.belief.rules(name, world.settlements[home]?.name), certainty: 'known' });
  }

  // losses you have come to know
  for (const bel of world.beliefs.get(id) ?? []) {
    if (bel.assertion !== 'dead' || computeBelief(bel, world.tick).stance !== 'true') continue;
    b.push({ icon: '⚰', text: PLAYER_VOICE.belief.isDead(fullName(world, bel.subject)), ref: { kind: 'actor', id: bel.subject }, certainty: 'known' });
    if (b.length >= 4) break;
  }

  // what you do NOT know — news still on the road (subjective absence: you are out of the loop).
  // this is the sentence that carries the thesis: the world holds information independent of you.
  if (home !== undefined) {
    let soonest: { subj: number; arrival: number } | undefined;
    for (const [key, val] of world.newsFront) {
      if (!key.startsWith(`${home}:ruler:`) || val.arrival <= world.tick) continue;
      if (!soonest || val.arrival < soonest.arrival) soonest = { subj: Number(key.split(':')[2]), arrival: val.arrival };
    }
    if (soonest) b.push({ icon: '…', text: PLAYER_VOICE.belief.noWord(world.settlements[soonest.subj]?.name), certainty: 'unknown' });
  }

  return b.slice(0, 6);
}

/** MOOD as the UI sees it: the number, the lived word, and every reason behind it. */
function buildMoodView(world: World, id: EntityId): { value: number; word: string; reasons: { label: string; value: number }[] } {
  const value = Math.round(computeMood(world, id));
  return { value, word: moodWord(value), reasons: moodReasons(world, id) };
}

/**
 * NEEDS AS LIVED EXPERIENCE (design/21 §5) — translate each raw drive into how it FEELS from the
 * inside ("Lonely", "Comfortable"), with a coarse tone. The words are pack flavour (NEED_FEELS);
 * the engine stays a number-store. A need with no pack words falls back to a generic band.
 */
function buildNeedFeels(world: World, id: EntityId): NeedFeel[] {
  const needs = world.needs.get(id);
  if (!needs) return [];
  const band = (v: number) => (v < 200 ? 0 : v < 400 ? 1 : v < 600 ? 2 : v < 800 ? 3 : 4);
  return NEEDS.map((k) => {
    const value = needs[k] ?? 0;
    const words = NEED_FEELS[k] ?? NEED_FEELS_GENERIC;
    const tone: NeedFeel['tone'] = value < 250 ? 'bad' : value < 450 ? 'warn' : 'good';
    return { key: k, feel: words[band(value)], tone, value };
  });
}

/** The single most pressing drive as a narrative beat, folded into the situation (design/21 §5).
 *  A starving need speaks first; else an earned high note; else silence. */
function buildBodyNote(world: World, id: EntityId): string | undefined {
  const needs = world.needs.get(id);
  if (!needs) return undefined;
  let worst: { k: string; v: number } | undefined;
  let best: { k: string; v: number } | undefined;
  for (const k of NEEDS) {
    const v = needs[k] ?? 0;
    if (!worst || v < worst.v) worst = { k, v };
    if (!best || v > best.v) best = { k, v };
  }
  if (worst && worst.v < 300 && NEED_BEAT_LOW[worst.k]) return NEED_BEAT_LOW[worst.k];
  if (best && best.v >= 820 && NEED_BEAT_HIGH[best.k]) return NEED_BEAT_HIGH[best.k];
  return undefined;
}

/**
 * GOAL AS DIAGNOSIS — not a quest tracker. The engine already knows why the player is failing;
 * this tells them, from inside their own head: what stands in the way, the best thing to do about
 * it, and a rough sense of how close they are. Derived from the aspiration ladder (aspirations.ts).
 */
function buildGoalDiagnosis(
  world: World,
  id: EntityId,
  asp: ReturnType<typeof currentAspiration>,
): { obstacle?: string; nextStep?: string; progress?: number } {
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const targetName = asp.target !== undefined ? fullName(world, asp.target) : undefined;
  const home = world.homeSettlement.get(id);
  const VOICE = PLAYER_VOICE.goal; // the words are pack voice; the thresholds are engine law

  // the best thing to do about it, from the goal's own action
  let nextStep: string | undefined =
    asp.action === 'court' && targetName ? VOICE.nextStep.court(targetName)
    : asp.action === 'socialize' && targetName ? VOICE.nextStep.socializeTarget(targetName)
    : asp.action === 'socialize' ? VOICE.nextStep.socialize
    : asp.action === 'work' ? VOICE.nextStep.work
    : undefined;

  let obstacle: string | undefined;
  let progress: number | undefined;
  switch (asp.kind) {
    case 'rule': {
      const rulerId = home !== undefined ? world.settlements[home]?.currentRulerId : undefined;
      const rname = rulerId !== undefined ? getFigure(world, rulerId)?.name : undefined;
      const std = standingOf(world, id);
      // narrator reading of your renown, then the person in the way — legible from your standing
      const reading = VOICE.rule.readings[std < 60 ? 0 : std < 150 ? 1 : 2];
      obstacle = VOICE.rule.obstacle(reading, rname);
      progress = clamp01(std / 300);
      nextStep = VOICE.nextStep.rule;
      break;
    }
    case 'wed': {
      if (asp.target === undefined) obstacle = VOICE.wed.noTarget;
      else {
        const edge = world.rels.get(id)?.get(asp.target);
        const op = edge ? computeOpinion(edge, world.tick) : 0;
        progress = clamp01(op / 650);
        obstacle =
          op < 200 ? VOICE.wed.scarcelyKnown(targetName!)
          : op < 400 ? VOICE.wed.growingCloser(targetName!)
          : VOICE.wed.nearlyWon(targetName!);
      }
      break;
    }
    case 'reconcile':
      obstacle = targetName ? VOICE.reconcile(targetName) : undefined;
      break;
    case 'family':
      obstacle = VOICE.family;
      break;
    case 'belonging':
      obstacle = VOICE.belonging;
      break;
  }

  return { obstacle, nextStep, progress };
}

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

  // the player's self-chosen ambition (its live step + progress) and the ambitions on offer.
  const ambView = lc.alive ? buildAmbitionView(world, id) : { ambition: undefined, offered: [] };

  // a one-click pursue intent, only when the goal is directly actionable
  let suggested: Intent | undefined;
  if (asp.action === 'work') suggested = { kind: 'work' };
  else if (asp.target !== undefined && (asp.action === 'court' || asp.action === 'socialize')) {
    suggested = { kind: asp.action, target: asp.target };
  }

  // the four "active" streams + cast, built once — the attention feed merges them (design/21 §7)
  const tensions = buildPlayerTensions(world, id);
  const opportunities = buildPlayerOpportunities(world, id, actors);
  const threats = buildPlayerThreats(world, id);
  const cast = buildPlayerCast(world, id);

  // DEATH AS A TRANSITION (the Dynasty step): while dead, offer the line's continuation.
  // Pure read — the handoff itself only happens when the player chooses it (inheritHeir).
  let succession: PlayerView['succession'];
  let lineEnds: string | undefined;
  if (!lc.alive) {
    const heir = heirOf(world, id);
    if (heir) {
      const heirHome = world.homeSettlement.get(heir.heirId);
      succession = {
        heirId: heir.heirId,
        heirName: fullName(world, heir.heirId),
        relation: PLAYER_VOICE.succession.relation[heir.relation],
        awayNote:
          heirHome !== undefined && heirHome !== world.focusedSettlementId
            ? PLAYER_VOICE.succession.away(world.settlements[heirHome]?.name ?? '?')
            : undefined,
        offer: PLAYER_VOICE.succession.continues,
      };
    } else {
      lineEnds = PLAYER_VOICE.succession.lineEnds;
    }
  }

  return {
    id,
    name: fullName(world, id),
    species: speciesById(idn.speciesId).name,
    profession: world.profession.get(id)!,
    ageYears: lc.ageYears,
    alive: lc.alive,
    deathYear: lc.deathTick !== undefined ? Math.floor(lc.deathTick / DAYS_PER_YEAR) : undefined,
    succession,
    lineEnds,
    settlement: homeId !== undefined ? world.settlements[homeId]?.name ?? '?' : '?',
    homeSettlementId: homeId,
    needs: { ...world.needs.get(id)! },
    needFeels: buildNeedFeels(world, id),
    mood: buildMoodView(world, id),
    bodyNote: buildBodyNote(world, id),
    aspiration: {
      kind: asp.kind,
      label: aspirationLabel(world, id, asp),
      targetName: asp.target !== undefined ? fullName(world, asp.target) : undefined,
      suggested,
      ...buildGoalDiagnosis(world, id, asp),
    },
    lastAchieved,
    actions: PLAYER_ACTIONS,
    targets: targets.slice(0, 40),
    story: buildPlayerStory(world, id),
    attention: buildAttention(tensions, opportunities, threats, cast),
    tensions,
    opportunities,
    threats,
    belief: buildPlayerBeliefs(world, id),
    cast,
    // framed turning points for a living player; the dead make no decisions.
    decisions: lc.alive ? evaluateDecisions(world, id) : [],
    ambition: ambView.ambition,
    offeredAmbitions: ambView.offered,
  };
}

/**
 * WHAT DESERVES MY ATTENTION (design/21 §7) — the four "active" streams and the cast are one
 * category, not five: people, changes, openings, worries. Merge them into a single feed sorted by
 * importance, like notifications. The categorized lists remain (as the journal's drill-down); this
 * is the digest the cockpit shows.
 */
function buildAttention(
  tensions: Tension[],
  opportunities: Tension[],
  threats: Tension[],
  cast: CastMember[],
): Tension[] {
  const items: { t: Tension; w: number; i: number }[] = [];
  let i = 0;
  // people you care about become attention lines — "Spouse — devoted", clickable to the person
  for (const c of cast) {
    const roleCap = c.role.charAt(0).toUpperCase() + c.role.slice(1);
    const hot = /rival|feud|enemy/.test(c.role) || c.role === 'spouse' || c.role === 'child' || c.role === 'parent';
    // when the line has an obvious response, put the verb ON the notification (an
    // affordance, taken through the ordinary player turn) — living co-residents only.
    let action: Tension['action'];
    if (c.kind === 'actor') {
      const verbs = PLAYER_VOICE.attention;
      if (/rival|feud|enemy/.test(c.role)) action = { label: verbs.confront, intent: { kind: 'provoke', target: c.id } };
      else if (c.role === 'courting') action = { label: verbs.court, intent: { kind: 'court', target: c.id } };
      else if (c.role === 'spouse' || c.role === 'ally') action = { label: verbs.spendTime, intent: { kind: 'socialize', target: c.id } };
    }
    items.push({ t: { icon: c.icon, text: `${roleCap} — ${c.status}`, ref: { kind: c.kind, id: c.id }, action }, w: hot ? 5 : 3, i: i++ });
  }
  for (const t of threats) items.push({ t, w: 4, i: i++ }); // worries deserve attention
  for (const t of tensions) items.push({ t, w: 3, i: i++ }); // what's changing
  for (const t of opportunities) items.push({ t, w: 2, i: i++ }); // openings
  // importance first, original order as a deterministic tiebreak
  items.sort((a, b) => b.w - a.w || a.i - b.i);
  return items.slice(0, 7).map((x) => x.t);
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

  // "Notable folk" = the most PROMINENT residents, not merely the oldest. Prominence blends
  // renown (deeds make you known — for good or ill), social centrality, holding power, and raw
  // ambition; age is only a final tiebreak, so elders no longer dominate the list.
  const prominence = (id: EntityId): number => {
    const home = world.homeSettlement.get(id);
    const isRuler = home !== undefined && world.settlements[home]?.currentRulerId === id;
    return (
      Math.abs(standingOf(world, id)) + // renown OR notoriety — both make you notable
      Math.min(relCount(world, id), 12) * 5 + // a touch of social centrality, tightly capped so
      //                                          the most-connected trade families don't own the list
      (isRuler ? 200 : 0) + // holding the seat is inherently notable
      ambitionOf(world.traits.get(id) ?? []) * 45 // the strivers — a hungry youth outranks a placid elder
    );
  };
  // computed once per actor, not inside the comparator (standing/ties are not free)
  const prominenceOf = new Map<EntityId, number>();
  for (const id of full) prominenceOf.set(id, prominence(id));
  const ranked = [...full].sort(
    (a, b) =>
      prominenceOf.get(b)! - prominenceOf.get(a)! ||
      world.lifecycle.get(b)!.ageYears - world.lifecycle.get(a)!.ageYears ||
      a - b,
  );
  // keep the roster VARIED: cap any single trade so a market town's merchants (who accrue the
  // most renown & ties) don't fill every slot — the player should see a mix of lives. Backfill
  // past the cap only if too few distinct folk remain.
  const NOTABLE_N = 8;
  const PROF_CAP = 3;
  const chosen: EntityId[] = [];
  const perProf = new Map<string, number>();
  for (const id of ranked) {
    if (chosen.length >= NOTABLE_N) break;
    const prof = world.profession.get(id) ?? '';
    if ((perProf.get(prof) ?? 0) >= PROF_CAP) continue;
    chosen.push(id);
    perProf.set(prof, (perProf.get(prof) ?? 0) + 1);
  }
  for (const id of ranked) {
    if (chosen.length >= NOTABLE_N) break;
    if (!chosen.includes(id)) chosen.push(id);
  }
  const notable = chosen.map((id) => actorView(world, id));

  const recent = world.events.slice(-feedSize).map((ev) => eventView(world, ev)).reverse();

  // The deep past lives in the ANNALS (permanent), so legends and named ages span
  // ALL of history — including a long pre-play worldgen — not just recent memory.
  // legends: the most momentous tales of all time
  const chronicleViews = [...world.annals]
    .sort((a, b) => b.interest - a.interest || a.eventId - b.eventId)
    .slice(0, 14)
    .map((t) => {
      const ev = getEvent(world, t.eventId);
      return ev ? { year: t.year, interest: t.interest, text: renderLegend(world, ev), eventId: t.eventId } : null;
    })
    .filter((v): v is { year: number; interest: number; text: string; eventId: number } => v !== null);

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
      return ev ? { year, title: eraTitle(world, ev), eventId: best.eventId } : null;
    })
    .filter((v): v is { year: number; title: string; eventId: number } => v !== null);

  // renowned figures of history: those who reigned longest (founders & great rulers)
  const curYear = Math.floor(world.tick / DAYS_PER_YEAR);
  const historicalFigures = [...world.figures]
    .sort((a, b) => ((b.deathYear ?? curYear) - b.reignStart) - ((a.deathYear ?? curYear) - a.reignStart) || a.id - b.id)
    .slice(0, 14)
    .map((f) => ({
      id: f.id,
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
  // prestige computed once per house, not inside the comparator (same discipline as the
  // "notable" residents selection above).
  const prestigeOf = new Map(world.houses.map((h) => [h.id, computeHousePrestige(h, world.tick)]));
  const houses = [...world.houses]
    .sort((a, b) => prestigeOf.get(b.id)! - prestigeOf.get(a.id)! || a.id - b.id)
    .slice(0, 12)
    .map((h) => ({
      id: h.id,
      name: h.name,
      founder: getFigure(world, h.founderId)?.name,
      meaning: world.houseMeaning.get(h.name),
      foundedYear: h.foundedYear,
      prestige: Math.round(prestigeOf.get(h.id)!),
      origin: world.settlements[h.originSettlementId]?.name ?? '?',
      seat: h.seatSettlementId !== undefined ? world.settlements[h.seatSettlementId]?.name : undefined,
      rulers: houseRulers.get(h.id)?.size ?? 1,
      extinctYear: h.extinctYear,
    }));

  // TONGUES — each living culture's language made explorable: its demonym, its sound, its
  // kin (the family it drifted from), a learnable lexicon sample, and towns that carry it.
  // Pure presentation of the pack's philology; deterministic from the seed, never stored.
  const livingCultures = [...new Set(world.settlements.filter((s) => s.ruinedYear === undefined).map((s) => s.cultureId))].sort();
  const tongues = livingCultures.map((cultureId) => ({
    cultureId,
    demonym: peopleName(cultureId, world.seed),
    voice: voiceOf(cultureId),
    kin: kinOf(cultureId).filter((c) => livingCultures.includes(c)),
    lexicon: LEXICON_SAMPLE.map(({ id, gloss }) => ({ root: lexeme(cultureId, world.seed, id), gloss })),
    towns: world.settlements
      .filter((s) => s.ruinedYear === undefined && s.cultureId === cultureId)
      .slice(0, 4)
      .map((s) => ({ name: s.name, meaning: s.nameMeaning })),
  }));
  // the culture roster's id→name/color mapping — the UI runs in a SEPARATE realm (a Web
  // Worker) from the simulation, so it cannot import CULTURES from engine/pack directly (that
  // binding lives worker-side, and stays the pack's static fallback on the main thread since
  // setCulturesForSeed never runs there). Carried in the snapshot so ui/common.tsx's
  // cultureName/cultureColor can resolve this world's GENERATED roster instead of showing
  // raw ids or the wrong palette.
  const cultureLegend = CULTURES.map((c) => ({ id: c.id, name: c.name, color: c.color }));

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
    tongues,
    cultureLegend,
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

  // mood, for actors simulated at full fidelity (any actor, not just the player —
  // every soul's inner weather is inspectable, per Legibility)
  const mood = world.selfThoughts.has(id) ? buildMoodView(world, id) : undefined;

  const beliefs = buildBeliefViews(world, id);

  return { actor: actorView(world, id), backstory: backstoryFor(world, id) ?? '', relationships, lifeEvents, reputation, mood, beliefs };
}

/** This actor's own beliefs, as the UI reads them — only the ones with a definite stance (an
 *  "unknown" belief has no net evidence and nothing legible to show). Belief-layer sibling of
 *  buildMoodView: the number/word/reasons pattern, applied to what this actor holds true. */
function buildBeliefViews(world: World, id: EntityId, limit = 6): BeliefView[] {
  const held = world.beliefs.get(id) ?? [];
  const views: BeliefView[] = [];
  for (const b of held) {
    const state = computeBelief(b, world.tick);
    if (state.stance === 'unknown') continue;
    views.push({
      subjectId: b.subject,
      subjectName: fullName(world, b.subject),
      label: assertionLabel(world, b.assertion),
      stance: state.stance,
      confidencePct: Math.round(state.confidence * 100),
      reasons: beliefReasons(b, world.tick),
    });
    if (views.length >= limit) break;
  }
  return views;
}

/** A belief's assertion string, as a plain noun phrase ("death", "rule of Eastwatch") — composes
 *  cleanly with either stance ("confirmed: death" / "denied: death"). Assertions are engine
 *  vocabulary (the fixed 'dead' predicate and the `reigns:` status-slot convention, both owned
 *  by belief.ts), not pack data, so the small lookup lives here beside the other
 *  presentation-only label helpers. */
function assertionLabel(world: World, assertion: string): string {
  if (assertion === 'dead') return 'death';
  const slot = assertion.startsWith('reigns:') ? assertion.slice('reigns:'.length) : undefined;
  if (slot?.startsWith('ruler:')) {
    const sid = Number(slot.slice('ruler:'.length));
    return `rule of ${world.settlements[sid]?.name ?? 'a settlement'}`;
  }
  return assertion;
}

/** A life-story for an actor, rendered from their real history in the pack's voice. Stable per
 *  actor (a fixed rng salt), so the same soul always reads the same. Presentation only. */
function backstoryFor(world: World, id: EntityId): string | undefined {
  const facts = backstoryFacts(world, id);
  return facts ? renderBackstory(facts, new Rng(mixSeed(world.seed, id, 0xba57))) : undefined;
}

/** Walk the causal ancestry of an event (breadth-first, de-duplicated), recording each
 *  ancestor's DEPTH from the root so the UI can indent the chain into a tree. getEvent()
 *  handles both the recent buffer and the archive transparently. Bounded so a densely-caused
 *  event can't produce a runaway wall. */
const MAX_CAUSE_NODES = 24;
export function inspectEvent(world: World, id: number): EventChain | undefined {
  const root = getEvent(world, id);
  if (!root) return undefined;

  const ancestors: CauseNode[] = [];
  const seen = new Set<number>([id]);
  let frontier = root.causes.map((cid) => ({ cid, depth: 1 }));
  while (frontier.length && ancestors.length < MAX_CAUSE_NODES) {
    const next: { cid: number; depth: number }[] = [];
    for (const { cid, depth } of frontier) {
      if (seen.has(cid) || ancestors.length >= MAX_CAUSE_NODES) continue;
      seen.add(cid);
      const ev = getEvent(world, cid);
      if (!ev) continue;
      ancestors.push({ event: eventView(world, ev), depth });
      for (const p of ev.causes) next.push({ cid: p, depth: depth + 1 });
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

  // Mark phase: BFS from all stable roots to collect referenced event IDs. Roots are
  // everything that resolves an event id later (getEvent): annals, chronicle, actor
  // memory — and every stored `cause`/`eventId` on reputation marks, belief evidence,
  // self-thoughts, relationship thoughts, and org negotiation records, so "why" chains
  // stay traceable however the reference is held (Legibility).
  const live = new Set<number>();
  for (const t of world.annals) live.add(t.eventId);
  for (const t of world.chronicle) live.add(t.eventId);
  for (const [, ids] of world.memory) for (const id of ids) live.add(id);
  for (const rep of world.reputation.values())
    for (const m of rep.marks) if (m.cause !== undefined) live.add(m.cause);
  for (const held of world.beliefs.values())
    for (const b of held) for (const ev of b.evidence) if (ev.cause !== undefined) live.add(ev.cause);
  for (const thoughts of world.selfThoughts.values())
    for (const t of thoughts) if (t.cause !== undefined) live.add(t.cause);
  for (const [a, inner] of world.rels)
    for (const [b, edge] of inner) {
      if (a > b) continue; // each undirected edge once
      for (const t of edge.thoughts) if (t.cause !== undefined) live.add(t.cause);
    }
  for (const li of world.lastInteraction.values()) live.add(li.eventId);

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
    // mood memory digest: count + summed value of stored self-thoughts (mood steers
    // NPC behaviour via mental breaks, so it belongs in the determinism hash)
    const st = world.selfThoughts.get(id) ?? [];
    let stSum = 0;
    for (const t of st) stSum += t.value;
    parts.push(
      `#${id}:${idn.given}.${idn.family}.${idn.speciesId}.${idn.sex}.` +
        `age${lc.ageYears}.alive${lc.alive ? 1 : 0}.death${lc.deathTick ?? -1}.` +
        `fid${world.fidelity.get(id) ?? '-'}.home${world.homeSettlement.get(id) ?? -1}.` +
        `sp${ties.spouses.join('-') || -1}.ch${ties.children.length}.rels${world.rels.get(id)!.size}.rsum${relSum}.rep${standing}.faith${world.faith.get(id) ?? ''}.` +
        `st${st.length}.stv${Math.round(stSum)}`,
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
    parts.push(`H${h.id}:${h.name}.f${h.founderId}.y${h.foundedYear}.p${Math.round(computeHousePrestige(h, world.tick))}.seat${h.seatSettlementId ?? -1}.x${h.extinctYear ?? -1}`);
  }
  for (const o of world.organizations) {
    const standing = Math.round(computeStanding(world.reputation.get(o.id) ?? emptyReputation(), world.tick));
    // roster digest: each record as role@actor[since:until] so institutional memory is hashed
    const roster = (world.orgMembers.get(o.id) ?? [])
      .map((m) => `${m.role}@${m.actorId}:${m.sinceTick}-${m.untilTick ?? -1}`)
      .join(',');
    const intent = world.currentIntent.get(o.id);
    const intentDigest = intent ? `${intent.kind}@${Math.round(intent.score)}` : '-';
    const ops = world.operationalState.get(o.id);
    const opsDigest = ops ? Object.keys(ops).sort().map((k) => `${k}${Math.round(ops[k])}`).join(',') : '-';
    const last = world.lastAction.get(o.id);
    const actDigest = last ? `${last.id}.${last.outcome}.t${last.sinceTick}` : '-';
    // 2C state: the treasury, and the org's relationship digest (opinion sum over its edges)
    let orgRelSum = 0;
    const orgEdges = world.rels.get(o.id);
    if (orgEdges) for (const [, e] of orgEdges) orgRelSum += computeOpinion(e, world.tick);
    const li = world.lastInteraction.get(o.id);
    const interDigest = li ? `${li.kind}.${li.role}.${li.accepted ? 1 : 0}.w${li.withOrg}.t${li.sinceTick}` : '-';
    parts.push(
      `O${o.id}:${o.subtype}.gov${o.governanceId}.ld${o.leaderId ?? -1}.seat${o.seatId ?? -1}.dis${o.dissolvedYear ?? -1}.sh${o.seatHistory.join('-')}.rep${standing}.` +
        `ty${Math.round(treasuryOf(world, o.id))}.orels${orgEdges?.size ?? 0}.orsum${Math.round(orgRelSum)}.mem[${roster}].int${intentDigest}.ops[${opsDigest}].act${actDigest}.dip${interDigest}`,
    );
  }
  // standing agreements (2E) — normalized a<b, in seal order
  for (const g of world.orgAgreements) {
    parts.push(`G${g.kind}:${g.a}-${g.b}.s${g.sinceTick}.e${g.expiresTick}`);
  }
  // active formal wars (2E) — sides in join order, in declaration order, with war-weariness
  for (const w of world.wars) {
    parts.push(`W${w.id}:[${w.sideA.join(',')}]v[${w.sideB.join(',')}].s${w.startTick}.c${w.lastClashTick}.x${w.exhaustionA}/${w.exhaustionB}`);
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
