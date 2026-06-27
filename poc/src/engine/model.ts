/**
 * The MythOS PoC data model.
 *
 * ECS-flavoured: an Entity is just a numeric id; data lives in component maps on
 * the World; systems iterate entities in id order. No methods on data, no class
 * hierarchy of "Actor" — exactly the inversion of Warsim's global/positional state.
 */
import { Rng } from './rng';
import { type Intent } from './intent';

export type EntityId = number;
export type Sex = 'm' | 'f';

/** The five data-defined needs (kept tiny for the PoC). */
export const NEED_KEYS = ['food', 'wealth', 'safety', 'esteem', 'belonging'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
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
  role: 'founder' | 'ruler';
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

export type EventType =
  | 'settlement_founded'
  // --- full-fidelity (focused settlement) events ---
  | 'born'
  | 'died'
  | 'died_brawl'
  | 'married'
  | 'widowed'
  | 'friendship'
  | 'rivalry'
  | 'feud'
  | 'dispute'
  | 'kindness'
  | 'brawl'
  // --- aggregate (macro layer) events ---
  | 'prosperity'
  | 'hardship'
  | 'milestone'
  | 'figure_passed'
  // --- geography & economy: trade, conflict, famine ---
  | 'trade'
  | 'raid'
  | 'famine'
  // --- director-fired incidents ---
  | 'boon'
  | 'blight'
  | 'plague'
  // --- landmark: a settlement falls to ruin ---
  | 'ruined'
  // --- historical figures: rulers & succession ---
  | 'ascension'
  | 'ruler_died'
  // --- wars, wonders, beasts, portents (Warsim/RimWorld/DF flavor) ---
  | 'battle'
  | 'conquest'
  | 'wonder'
  | 'beast'
  | 'omen'
  // --- migration / cross-settlement ---
  | 'emigrated'
  | 'immigrated'
  // --- LOD control ---
  | 'focus_shift';

export type SettlementId = number;

/**
 * Aggregate ("macro") population state for a settlement that is NOT being
 * simulated in detail. Evolves by rates, costs O(1) per year, and holds NO
 * individual entities — this is what lets the world be far larger than the set
 * of actors we can afford to simulate.
 */
export interface MacroPop {
  population: number;
  children: number; // age < ADULT_AGE
  adults: number; // ADULT_AGE..ELDER_AGE
  elders: number; // >= ELDER_AGE
  stability: number; // -100..100, drives prosperity/hardship
  dominantSpecies: string;
}

// ---- economy ----

export const RESOURCE_KEYS = ['food', 'materials', 'goods'] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type Specialization = 'farming' | 'mining' | 'crafting' | 'balanced';

/** A settlement's local economy: what it has, what it's worth there, how rich it is. */
export interface Economy {
  specialization: Specialization;
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
  /** the figure who currently rules here (founder, then a line of successors). */
  currentRulerId?: FigureId;
  macro: MacroPop;
  econ: Economy;
}

/** The whole world state. Everything needed to reconstruct the sim lives here. */
export interface World {
  seed: number;
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

export interface EventView {
  id: EventId;
  year: number;
  type: EventType;
  text: string;
  subjects: EntityId[];
  causes: EventId[];
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
  founder?: string; // who founded it
  ruler?: string; // who rules it now (or last, if a ruin)
  // economy
  specialization: Specialization;
  wealth: number;
  foodSecurity: number; // stock.food / population => years of food buffer
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
