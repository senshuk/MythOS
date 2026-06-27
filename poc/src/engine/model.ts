/**
 * The MythOS PoC data model.
 *
 * ECS-flavoured: an Entity is just a numeric id; data lives in component maps on
 * the World; systems iterate entities in id order. No methods on data, no class
 * hierarchy of "Actor" — exactly the inversion of Warsim's global/positional state.
 */
import { Rng } from './rng';
import { type Intent } from './intent';
import { type Geography } from './geography';

export type EntityId = number;
/** A sex label. NOT a fixed 'm'|'f': the set of sexes is SPECIES DATA (a species
 *  may have two, one — hermaphroditic/asexual — or more). The engine treats it as an
 *  opaque string and dispatches reproduction through the species' Reproduction data. */
export type Sex = string;

/** A need is identified by an open string id; the SET of needs is pack data
 *  (`content/fixture.ts` NEEDS), and the engine reads behaviourally-wired needs by
 *  ROLE (SUBSISTENCE_NEED, …) rather than a literal id. */
export type NeedKey = string;
export type Needs = Record<NeedKey, number>; // 0..1000

export interface Identity {
  given: string;
  family: string;
  sex: Sex;
  speciesId: string;
}

export interface Lifecycle {
  bornTick: number;
  ageYears: number;
  alive: boolean;
  deathTick?: number;
}

export interface SocialTies {
  spouse?: EntityId;
  parents: EntityId[];
  children: EntityId[];
}

export interface RelFlags {
  friend?: boolean;
  rival?: boolean;
  feud?: boolean;
  spouse?: boolean;
}

/**
 * A single sourced, (usually) decaying opinion delta — the RimWorld "thought"
 * idea. Opinion of someone is the summed, diminishing-returns total of these, so
 * a relationship is legible ("+90 a kindness, −44 two quarrels that are fading")
 * and emergent (many small interactions accrue, stack, and fade).
 */
export type ThoughtKind = 'bonded' | 'quarrelled' | 'kindness' | 'slighted' | 'wed' | 'griefShared';

export interface Thought {
  kind: ThoughtKind;
  value: number; // opinion delta (+/-)
  sinceTick: number;
  expiresTick?: number; // undefined = permanent
  cause?: EventId; // the event that produced it (legibility)
}

/** Undirected relationship edge (stored symmetrically in both actors' maps). */
export interface RelEdge {
  thoughts: Thought[]; // opinion = computeOpinion(thoughts) — see opinion.ts
  sinceTick: number;
  flags: RelFlags;
}

export type EventId = number;
export type FigureId = EntityId; // shares the id space; resolves via the name registry

/**
 * The capacity in which the world remembers a figure. An OPEN string, like EventType:
 * the engine mints two STRUCTURAL roles today ('founder' of a settlement, 'ruler' of a
 * polity), but a pack or future system can remember others — a 'prophet', 'inventor',
 * 'hero', 'traitor', 'explorer' — without an engine change. The leader's flavourful
 * TITLE (Lord / Speaker / Captain / CEO) is separate pack data; this is the role.
 */
export type FigureRole = string;

/**
 * A historical figure — a named person the world *remembers* (founder, ruler…),
 * tracked as a lightweight RECORD, not a fully-simulated ECS actor (DF's model).
 * Minted by the aggregate layer during worldgen so the deep past has people, not
 * just faceless events. Has an id + a name in `world.names` (so events can name
 * it) but no components, so the actor systems never touch it.
 */
export interface HistoricalFigure {
  id: FigureId;
  name: string;
  species: string;
  role: FigureRole;
  settlementId: SettlementId;
  bornYear: number;
  deathYear?: number;
  reignStart: number;
  reignEnd: number; // the year this figure's rule is fated to end
}

/**
 * A structured, dated, entity-referencing record of something that happened.
 * Text is NOT stored here — it is rendered from this structure on demand (see
 * render.ts), so history stays queryable and free of delimiter hazards.
 */
export interface WorldEvent {
  id: EventId;
  tick: number;
  year: number;
  type: EventType;
  subjects: EntityId[];
  data: Record<string, number | string>;
  causes: EventId[]; // parent events -> the causal story graph
}

/**
 * An event's type is an OPEN string, not a fixed enum — the VOCABULARY of events is
 * owned by the Universe Pack (see `content/narrative.ts`), so a pack can introduce
 * new kinds (a sci-fi `warp_jump`, a `schism`…) without editing the engine. The
 * pack supplies each type's prose, interest weight, and grammar. The kinds this PoC
 * pack emits today: settlement_founded, born, died, died_brawl, married, widowed,
 * friendship, rivalry, feud, dispute, kindness, brawl, prosperity, hardship,
 * milestone, figure_passed, trade, raid, famine, boon, blight, plague, ruined,
 * ascension, ruler_died, battle, conquest, wonder, beast, omen, emigrated,
 * immigrated, goal_met, focus_shift.
 */
export type EventType = string;

export type SettlementId = number;

/**
 * Aggregate ("macro") population state for a settlement that is NOT being
 * simulated in detail. Evolves by rates, costs O(1) per year, and holds NO
 * individual entities — this is what lets the world be far larger than the set
 * of actors we can afford to simulate.
 */
export interface MacroPop {
  population: number;
  children: number; // age < dominant species' maturity
  adults: number; // maturity..elderhood (of the dominant species)
  elders: number; // >= dominant species' elderhood
  stability: number; // -100..100, drives prosperity/hardship
  dominantSpecies: string;
}

// ---- economy ----

/** Resources and specializations are open string ids; the SETS are pack data
 *  (`content/fixture.ts` RESOURCES / SPECIALIZATIONS). The engine's economy operates
 *  over the resource vector generically and reads role resources (SUBSISTENCE_RESOURCE,
 *  PREMIUM_RESOURCE) by name from the pack. */
export type ResourceKey = string;
export type Specialization = string;

/** A settlement's local economy: what it has, what it's worth there, how rich it is. */
export interface Economy {
  specialization: Specialization; // a display label for what the land makes here
  production: Record<ResourceKey, number>; // per-capita yields, DERIVED FROM LOCAL TERRAIN
  stock: Record<ResourceKey, number>; // units on hand
  price: Record<ResourceKey, number>; // local price (scarcity-driven)
  wealth: number; // accumulated prosperity from production + trade
}

/** The three simulation fidelity tiers an actor can be in. */
export type Fidelity = 'full' | 'summary';

export interface Vec2 {
  x: number;
  y: number;
}

/** An undirected trade route / border between two adjacent settlements. */
export interface RegionEdge {
  a: SettlementId;
  b: SettlementId;
  distance: number; // euclidean, fixed at worldgen
  relation: number; // -100..100, drifts; > 0 => trade, << 0 => raids
  tradeVolume: number; // recent trade activity (flavour / display)
}

export interface Settlement {
  id: SettlementId;
  name: string;
  pos: Vec2;
  foundedYear: number;
  /** true => simulated per-actor (the focused settlement); false => aggregate. */
  detailed: boolean;
  /** bumps each time the settlement is demoted; keys deterministic re-generation. */
  epoch: number;
  /** this settlement's OWN deterministic RNG stream cursor (locality-independent). */
  rngState: number;
  /** set to the year the settlement fell to ruin (population reached 0). */
  ruinedYear?: number;
  /** this polity's government (succession model) — a pack id; see content/fixture. */
  governmentId: string;
  /** this people's culture (value profile) — a pack id; drives inter-settlement relations. */
  cultureId: string;
  /** how much population this site's LAND can sustain — a multiplier on base carrying
   *  capacity, from local fertility/water/coast. Generous land grows great cities. */
  capacity: number;
  /** the figure who currently rules here (founder, then a line of successors). Absent
   *  in a leaderless polity (government with no leader). */
  currentRulerId?: FigureId;
  macro: MacroPop;
  econ: Economy;
}

/** The whole world state. Everything needed to reconstruct the sim lives here. */
export interface World {
  seed: number;
  /** the physical world — elevation, water, rivers, fertility. The substrate that
   *  drives settlement placement, resources, economy & development. Deterministic from
   *  the seed (regenerated on load, never serialized). */
  geography: Geography;
  tick: number; // base unit = 1 day
  /** The ACTIVE stream — always the focused settlement's own RNG. */
  rng: Rng;

  settlements: Settlement[];
  /** undirected adjacency graph over settlements (trade routes / borders). */
  edges: RegionEdge[];
  /** dedicated RNG stream for inter-settlement geography (trade/conflict drift). */
  geoRngState: number;
  focusedSettlementId: SettlementId;
  /** which settlement each live actor (full or summary) belongs to. */
  homeSettlement: Map<EntityId, SettlementId>;
  /**
   * Fidelity tier per live entity. INVARIANT: 'full' actors reside in the focused
   * settlement; 'summary' actors (named individuals tracked world-wide) reside
   * elsewhere. The anonymous mass has no entity at all (it's in MacroPop).
   */
  fidelity: Map<EntityId, Fidelity>;

  nextEntityId: EntityId;
  nextEventId: EventId;

  /** All entities ever created, in creation (id) order — deterministic iteration. */
  entities: EntityId[];

  identity: Map<EntityId, Identity>;
  /**
   * Persistent display-name registry. Unlike `identity` (which is freed when an
   * actor is demoted away), this is NEVER deleted, so the history log can still
   * render the names of actors that are no longer simulated. (A production engine
   * would prune this to names still referenced by retained events.)
   */
  names: Map<EntityId, string>;
  lifecycle: Map<EntityId, Lifecycle>;
  needs: Map<EntityId, Needs>;
  traits: Map<EntityId, string[]>;
  profession: Map<EntityId, string>;
  ties: Map<EntityId, SocialTies>;
  memory: Map<EntityId, EventId[]>; // bounded recent events per actor
  rels: Map<EntityId, Map<EntityId, RelEdge>>;

  events: WorldEvent[];

  /** Rolling living memory: recent notable events, bounded and FADING. Drives the
   *  Director's sense of recent drama. */
  chronicle: Tale[];
  /** Permanent recorded history — the most momentous events of ALL time, plus
   *  landmark foundings/ruins. Bounded but does NOT fade, so a deep pre-play past
   *  survives for the player to inherit. Feeds the named ages & legends. */
  annals: Tale[];
  /** index into `events` up to which the chronicle/annals have been considered. */
  chronicleCursor: number;

  /** The AI Director — paces drama by reading state and firing incidents. */
  director: DirectorState;
  /** dedicated RNG stream for the director (independent of focus). */
  directorRngState: number;

  /** Named people the world remembers (founders, rulers) — the legends database. */
  figures: HistoricalFigure[];
  /** dedicated RNG stream for minting historical figures during worldgen. */
  figureRngState: number;

  // ---- player-as-actor rails (an actor the player controls) ----
  /** The actor the player controls, if any. The ONLY thing that distinguishes a
   *  player from an NPC — both obey identical rules; only their intent *source*
   *  differs (UI input vs decideActor). Undefined = a pure spectator world. */
  playerId?: EntityId;
  /** Dedicated RNG stream for resolving the player's actions, so player randomness
   *  never perturbs the shared settlement stream (NPC outcomes stay independent of
   *  how much randomness the player consumed). Same pattern as the director/geo/
   *  figure streams. */
  playerRngState: number;
  /** The player's last-evaluated aspiration (kind + target), used to detect when a
   *  goal is fulfilled so the moment can be celebrated. Undefined until baselined
   *  at possession. Player-only — NPC milestones already surface as their own
   *  events (married, born, …). */
  playerGoal?: { kind: string; target?: EntityId };
  /** Append-only log of the player's intents, stamped with the tick they apply on.
   *  The world is f(seed, playerInputs): re-feeding this log reproduces the world
   *  exactly — the basis of save/replay (and, later, multiplayer). */
  playerInputs: { tick: number; intent: Intent }[];
}

export interface DirectorState {
  personality: string; // which storyteller (Balanced / Grim / Gentle / Chaotic)
  tension: number; // unspent dramatic pressure; rises during calm, relieved by drama
  incidents: number; // how many incidents fired
  lastIncidentYear: number;
}

export const DAYS_PER_YEAR = 365;
/**
 * TYPICAL adulthood/elderhood ages — a humanlike default. The simulation no longer
 * uses these for aging: life stages are SPECIES DATA (`Species.maturity`/`elderhood`/
 * fertility in the pack), read via the fixture accessors, so a long-lived and a
 * short-lived species age on their own schedules. These remain only as a neutral
 * reference (e.g. for tests) and a sensible fallback magnitude.
 */
export const ADULT_AGE = 16;
export const ELDER_AGE = 55;
export const MEMORY_LIMIT = 12;
export const CONTRIB_LIMIT = 5;

/**
 * A Tale: a notable event the world remembers, scored by `interest`
 * (memorability). The Chronicle is a bounded, interest-weighted set of these —
 * old tales fade unless they were momentous — and it feeds named years and
 * legends (history re-narrated as worldbuilding content). The RimWorld Tale idea.
 */
export interface Tale {
  eventId: EventId;
  year: number;
  tick: number;
  interest: number;
  /** a foundational landmark (founding/ruin) — kept in the annals forever. */
  landmark?: boolean;
}

// ---- Snapshot types sent across the worker boundary (read-only views) -------

export interface ActorView {
  id: EntityId;
  name: string;
  species: string;
  sex: Sex;
  ageYears: number;
  alive: boolean;
  deathYear?: number;
  profession: string;
  traits: string[];
  spouse?: EntityId;
  relationshipCount: number;
}

/** A clickable reference to an entity named in an event's prose. */
export type EventRef =
  | { kind: 'actor'; id: EntityId }
  | { kind: 'figure'; id: EntityId }
  | { kind: 'settlement'; id: SettlementId };

/** One run of an event's rendered prose — plain text, or a clickable entity ref. */
export interface EventPart {
  text: string;
  ref?: EventRef;
}

export interface EventView {
  id: EventId;
  year: number;
  type: EventType;
  text: string;
  /** the prose split into parts, with named settlements/people linkified (clickable). */
  parts: EventPart[];
  subjects: EntityId[];
  causes: EventId[];
}

/** Detail for a remembered historical FIGURE (a record, not a live actor). */
export interface FigureDetail {
  id: EntityId;
  name: string;
  species: string;
  role: string;
  settlement: string;
  settlementId: SettlementId;
  bornYear: number;
  deathYear?: number;
  reignStart: number;
  reignEnd?: number;
  lifeEvents: EventView[];
}

/** Detail for a SETTLEMENT: the id (its present state is already in the snapshot's
 *  settlement list) plus every event that names it — its whole local history. */
export interface SettlementDetail {
  settlementId: SettlementId;
  events: EventView[];
}

export interface RelationView {
  otherId: EntityId;
  otherName: string;
  valence: number;
  kind: string;
  /** the thoughts behind this opinion, so the UI can show *why* — legibility. */
  reasons: { label: string; value: number }[];
  /** true if the other person now lives in a different settlement. */
  away: boolean;
  otherSettlement?: string;
}

export interface SettlementView {
  id: SettlementId;
  name: string;
  detailed: boolean;
  population: number;
  foundedYear: number;
  dominantSpecies: string;
  stability: number;
  figureNames: string[];
  ruinedYear?: number; // set if the settlement is a ruin
  government: string; // the polity's government (display label, e.g. 'Lord'/'Speaker'/'free folk')
  leaderTitle: string; // the leader's title ('' if leaderless) — for "ruled by {title} X"
  culture: string; // the people's culture name (e.g. 'the Iron Creed')
  founder?: string; // who founded it
  ruler?: string; // who rules it now (or last, if a ruin)
  // economy
  specialization: Specialization;
  wealth: number;
  subsistenceSecurity: number; // stock[SUBSISTENCE_RESOURCE] / population => years of staple buffer
  prices: Record<ResourceKey, number>;
}

export interface MapNodeView {
  id: SettlementId;
  name: string;
  x: number;
  y: number;
  population: number;
  detailed: boolean;
  ruined: boolean;
  cultureId: string; // for colouring the map by culture
}

export interface MapEdgeView {
  a: SettlementId;
  b: SettlementId;
  relation: number;
  distance: number;
  tradeVolume: number;
}

export interface RegionMapView {
  nodes: MapNodeView[];
  edges: MapEdgeView[];
}

export interface TaleView {
  year: number;
  interest: number;
  text: string; // the legend retelling
}

export interface EraView {
  year: number;
  title: string; // "the Year of Famine in Stonereach"
}

export interface FigureView {
  name: string;
  role: string;
  settlement: string;
  bornYear: number;
  deathYear?: number;
  reignStart: number;
  reignEnd?: number; // for the living; undefined once dead
}

export interface DirectorView {
  personality: string;
  label: string;
  tension: number; // 0..200
  incidents: number;
  mood: string; // "calm" | "building tension" | "stirring the pot" …
  options: { id: string; label: string }[]; // selectable personalities
}

/** An action the player can choose this turn (mirrors the Intent vocabulary). */
export interface PlayerActionView {
  kind: 'idle' | 'work' | 'socialize' | 'court' | 'give' | 'provoke';
  label: string;
  hint: string;
  needsTarget: boolean;
}

/** Someone the player can direct a targeted action at, with the current bond. */
export interface PlayerTargetView {
  id: EntityId;
  name: string;
  relation: string; // 'spouse' | 'friend' | 'feud' | 'rival' | 'acquaintance' | 'stranger'
  valence: number;
}

/** The controlled actor's actionable state: who they are, how they're doing, and
 *  what they can do right now (and to whom). The affordance view the action bar
 *  renders — distinct from the read-only ActorDetail inspector. */
export interface PlayerView {
  id: EntityId;
  name: string;
  species: string;
  profession: string;
  ageYears: number;
  alive: boolean;
  deathYear?: number;
  settlement: string;
  needs: Needs;
  // the actor's current drive (a goal). `suggested` is the one-click action that
  // pursues it, when the goal points at a concrete action/target.
  aspiration: { kind: string; label: string; targetName?: string; suggested?: Intent };
  /** rendered text of a recently-fulfilled goal, for a transient celebration. */
  lastAchieved?: string;
  actions: PlayerActionView[];
  targets: PlayerTargetView[];
}

export interface Snapshot {
  seed: number;
  year: number;
  tick: number;
  settlementName: string; // the focused settlement
  population: number; // focused settlement population (detailed)
  totalBorn: number;
  totalDied: number;
  marriages: number;
  feuds: number;
  notable: ActorView[];
  actors: ActorView[];
  recentEvents: EventView[];

  // --- LOD / world-scale ---
  focusedSettlementId: SettlementId;
  worldPopulation: number; // sum across ALL settlements (detailed + aggregate)
  simulatedInDetail: number; // full actor count (bounded regardless of world size)
  namedPeople: number; // summary actors tracked across the world (also bounded)
  worldWealth: number; // total wealth across all settlements
  settlements: SettlementView[];
  map: RegionMapView; // positions + edges for drawing the region map
  chronicle: TaleView[]; // the world's most memorable events, retold as legends
  eras: EraView[]; // named years ("the Year of …")
  director: DirectorView; // the storyteller's current state
  historicalFigures: FigureView[]; // renowned people of history (founders, rulers)
  player?: PlayerView; // the controlled actor's actionable state, if any
}

export interface ActorDetail {
  actor: ActorView;
  relationships: RelationView[];
  lifeEvents: EventView[];
}

export interface EventChain {
  root: EventView;
  ancestors: EventView[]; // flattened causal ancestors, newest cause first
}
