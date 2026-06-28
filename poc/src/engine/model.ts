/**
 * The MythOS PoC data model.
 *
 * ECS-flavoured: an Entity is just a numeric id; data lives in component maps on
 * the World; systems iterate entities in id order. No methods on data, no class
 * hierarchy of "Actor" — exactly the inversion of Warsim's global/positional state.
 */
import { Rng } from './rng';
import { type Intent } from './intent';
import { type Substrate } from './substrate';

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
  /** current spouses. 0 = unwed; monogamous species hold at most 1, but the model does
   *  not ASSUME monogamy — a non-monogamous species (Reproduction.monogamous=false) may
   *  hold several. Use isWed / primarySpouse / canTakeSpouse (world.ts) to read it. */
  spouses: EntityId[];
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
/** An OPEN string id, like EventType: the SET of thought kinds (and what each is worth,
 *  how long it lasts, how it stacks, its inspector label) is PACK DATA — see
 *  `content/fixture.ts` THOUGHT_SPECS. The engine's social systems emit a few structural
 *  kinds (bonded/quarrelled/kindness/slighted/wed/griefShared), but a pack can retune
 *  those or add its own (a 'debt-of-honour', a 'corporate-betrayal') without engine edits. */
export type ThoughtKind = string;

/** How a kind of thought behaves — supplied by the pack, read by the opinion engine. */
export interface ThoughtSpec {
  base: number; // default opinion delta
  durationTicks?: number; // undefined => permanent
  stackLimit: number; // max thoughts of this kind kept on an edge
  mult: number; // diminishing-returns factor: the i-th stack counts value * mult^i
  label: string; // shown in the inspector
}

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

/**
 * How a kind of REPUTATION MARK behaves — pack data, read by the reputation engine
 * (the community-scale parallel of ThoughtSpec: a public deed marks an actor's
 * standing with everyone, not a single bond). The SET of kinds and their weights is
 * PACK DATA (`content/fixture.ts` REPUTE_SPECS).
 */
export interface ReputeSpec {
  base: number; // standing delta (− = notoriety, + = renown)
  durationTicks?: number; // undefined => permanent
  /** the opinion-thought each WITNESS forms toward the actor (kind + value), if any.
   *  Absent ⇒ the deed touches public standing only, not personal bonds. `escalates`
   *  routes a grave (negative) deed through the rivalry/feud rule. */
  witnessThought?: { kind: string; value: number; escalates?: boolean };
  label: string; // shown in the inspector ("shed blood")
}

/**
 * A single sourced, witness-weighted, (usually) decaying mark on an actor's public
 * standing — a deed the community PERCEIVED. Standing is the summed total of these
 * (see reputation.ts), so reputation is legible ("known for: shed blood, seen by 7")
 * and earned (only what others witnessed counts).
 */
export interface ReputeMark {
  kind: string; // open id; the SET is pack data (content/fixture REPUTE_SPECS)
  value: number; // standing delta (+/-)
  sinceTick: number;
  expiresTick?: number; // undefined = permanent
  witnesses: number; // how many saw it — scales how widely it is known
  cause?: EventId; // the event that produced it (legibility)
}

/** An actor's public reputation: a bounded list of sourced marks. */
export interface Reputation {
  marks: ReputeMark[];
}

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
  /** the House (lineage) this figure belongs to, if any — see House. */
  houseId?: HouseId;
}

export type HouseId = EntityId; // shares the id space (monotonic), but never named in the registry

/**
 * A HOUSE — a named lineage that endures across generations (a noble house, clan, or
 * dynasty; a sci-fi pack might read them as Great Families). Generic and universe-agnostic:
 * the engine knows only that figures belong to a line that holds seats, accrues prestige
 * from its members' deeds, and can rise, fall from power, or end. This is what turns a
 * string of rulers into a *dynasty* the player can follow as a family saga.
 */
export interface House {
  id: HouseId;
  name: string; // the house surname, carried by its rulers across the generations
  founderId: FigureId;
  foundedYear: number;
  originSettlementId: SettlementId;
  /** standing accrued from its members' deeds (founding, ruling, conquest) — ranks the
   *  great houses and decays only by losing power. */
  prestige: number;
  /** the settlement it currently rules, if any (undefined once it has fallen from power). */
  seatSettlementId?: SettlementId;
  /** the year the line ended — fell with a razed seat. Absent while it endures, even out
   *  of power (a former dynasty lingers in the rankings). */
  extinctYear?: number;
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
 * A Location's id. The same numeric id space as SettlementId today — every Settlement
 * IS a Location (see the Location/Settlement relationship below), so a settlement's id
 * is also its location id. Generic (non-settlement) locations are allocated ids from
 * world.nextLocationId, starting above the dense settlement range.
 */
export type LocationId = number;

/** A pack-defined location-type label ('settlement', 'city', 'starship', 'room', …).
 *  The engine treats it as an open string — it never enumerates valid types. */
export type LocationType = string;

/** Whether a Location can move. DECLARATIVE for now — the engine records that a thing
 *  *can* move; movement mechanics (transit, travel events) are a later phase. A Vehicle
 *  in the ontology is simply a Location with mobility='mobile'. */
export type Mobility = 'fixed' | 'mobile';

/** Where a Location sits in the world model. Foundation form: a 2D surface coordinate
 *  (same shape as Settlement.pos today). Documented to generalize later to a union that
 *  also admits a graph-node identifier, without disturbing callers that read pos.x/pos.y. */
export type WorldPosition = Vec2;

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

// ---- aspirations (an actor's emergent goal) ----

/** How an actor pursues a goal (decide.ts maps it to an Intent). A small fixed set of
 *  generic verbs; the universe-specific part is WHICH goals exist, not how they're
 *  pursued. (Broadening this vocabulary is a separate audit item, B2.) */
export type AspirationAction = 'work' | 'court' | 'socialize' | 'idle';

/** An actor's current goal — a PURE FUNCTION of state, derived not stored. */
export interface Aspiration {
  kind: string; // open id; the SET of goals is pack data (content/aspirations.ts)
  target?: EntityId;
  action: AspirationAction;
}

/**
 * One rung of a pack's aspiration ladder. The engine evaluates the ordered list and
 * takes the FIRST whose `applies` holds, so the set, order, conditions, labels and
 * fulfilment of goals are ALL pack data — a sci-fi pack can swap 'wed/family' for
 * 'explore/ascend' without touching the engine. (Methods, unlike entity components,
 * are allowed here: this is a behaviour descriptor the pack supplies, not stored data.)
 */
export interface AspirationDef {
  kind: string;
  /** does this goal apply to this actor right now? (priority = list order) */
  applies(world: World, id: EntityId): boolean;
  /** who/what the goal points at, if anything. */
  target?(world: World, id: EntityId): EntityId | undefined;
  /** how to pursue it (may depend on whether a target was found). */
  action(target: EntityId | undefined): AspirationAction;
  /** player-facing one-line description. */
  label(world: World, id: EntityId, target: EntityId | undefined): string;
  /** present => this goal is an ACHIEVEMENT: checkPlayerGoal fires `goal_met` when it
   *  becomes true after having been the player's goal. Absent => an ongoing state. */
  fulfilled?(world: World, id: EntityId, target: EntityId | undefined): boolean;
}

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

/**
 * A LOCATION — the engine's generic spatial container (constitution: `design/11`,
 * `design/14`). A Location holds a place in the world tree (parentId), has a
 * pack-defined type label, declares whether it can move, and may sit at a world
 * position. This is the canonical spatial type; `Settlement` is one subtype of it
 * (`Settlement ⊂ Location`). Mutation of the containment tree goes only through
 * `engine/location.ts`. NB: `pos` is OPTIONAL here — a pure container (a room inside
 * a building) need not have its own map coordinate; Settlement narrows it to required.
 */
export interface Location {
  id: LocationId;
  name: string;
  /** what the name MEANS in the founders' tongue ("the iron hold") — procedural philology. */
  nameMeaning?: string;
  /** pack-defined type label ('settlement', 'planet', 'room', 'starship', …). */
  locationType: LocationType;
  /** whether this location can move. DECLARATIVE only at this stage — no movement yet. */
  mobility: Mobility;
  /** the location that immediately CONTAINS this one (a city inside a kingdom), or
   *  undefined for a root. The containment tree is acyclic; see engine/location.ts. */
  parentId?: LocationId;
  /** position in the world model. Optional: a contained location may inherit/derive its
   *  place from its parent rather than hold its own coordinate. */
  pos?: WorldPosition;
  foundedYear: number;
  /** set to the year the location fell to ruin / was destroyed. */
  ruinedYear?: number;
}

/**
 * A SETTLEMENT — a populated, simulated Location (the only Location subtype the engine
 * materializes today). Extends Location with the simulation-heavy state: demographics,
 * economy, governance, culture, and LOD bookkeeping. Every Settlement is a Location;
 * not every Location is a Settlement.
 */
export interface Settlement extends Location {
  id: SettlementId;
  /** cached name of the founding figure — set at founding, avoids O(figures) scan per snapshot. */
  founderName?: string;
  /** a settlement always has a concrete map position (narrows Location.pos). */
  pos: WorldPosition;
  /** true => simulated per-actor (the focused settlement); false => aggregate. */
  detailed: boolean;
  /** bumps each time the settlement is demoted; keys deterministic re-generation. */
  epoch: number;
  /** this settlement's OWN deterministic RNG stream cursor (locality-independent). */
  rngState: number;
  /** NB: ruinedYear lives on the Location base (set when population reaches 0). */
  /** this polity's government (succession model) — a pack id; see content/fixture. */
  governmentId: string;
  /** this people's culture (value profile) — a pack id; drives inter-settlement relations. */
  cultureId: string;
  /** Tick when a contested_succession started a civil war clock. The war resolves
   *  (expelling the losing faction leader) after CIVIL_WAR_GRACE_YEARS if the split
   *  persists. Undefined = no active clock. Serialized as part of the settlements array. */
  civilWarTick?: number;
  /** how much population this site's LAND can sustain — a multiplier on base carrying
   *  capacity, from local fertility/water/coast. Generous land grows great cities. */
  capacity: number;
  /** the figure who currently rules here (founder, then a line of successors). Absent
   *  in a leaderless polity (government with no leader). */
  currentRulerId?: FigureId;
  macro: MacroPop;
  econ: Economy;
}

/** Tracks an actor who has been formally expelled from their home settlement.
 *  Serialized so Stage 3 (exile-and-return) can send them back. */
export interface ExileRecord {
  fromSettlementId: SettlementId;
  /** The value axis the civil war was fought over. */
  axis: string;
  /** Name of the faction they belonged to when expelled. */
  factionName: string;
  year: number;
}

/** The active factional split in the focused settlement: which value axis divides
 *  the community and who leads each wing. Recomputed yearly; NOT serialized (fully
 *  derived from world.personality which IS saved). */
export interface FactionSplit {
  /** The value axis the community is most divided on ('war', 'tradition', …). */
  axis: string;
  /** Name for the pro-axis wing (high values), e.g. 'the Swords'. */
  highName: string;
  /** Name for the anti-axis wing (low values), e.g. 'the Shields'. */
  lowName: string;
  /** Resident with the most extreme high value — de-facto champion of the pro-axis side. */
  highLeaderId?: EntityId;
  /** Resident with the most extreme low value. */
  lowLeaderId?: EntityId;
  /** Cached settlement mean for this axis so factionOf() is O(1), not O(n). */
  axisMean: number;
}

/** The whole world state. Everything needed to reconstruct the sim lives here. */
export interface World {
  seed: number;
  /** the physical world (a `Substrate` — a 2D surface today, but the engine assumes
   *  nothing of the kind). Drives settlement placement, resources, economy & development.
   *  Deterministic from the seed (regenerated on load, never serialized). */
  substrate: Substrate;
  tick: number; // base unit = 1 day
  /** The ACTIVE stream — always the focused settlement's own RNG. */
  rng: Rng;

  settlements: Settlement[];
  /**
   * The unified containment registry: EVERY Location keyed by its id, including the
   * settlements (stored BY REFERENCE — the same objects that live in `settlements[]`,
   * so there is no dual-storage divergence) plus any generic non-settlement locations
   * (planets, districts, rooms, ships…). The parent/child tree and the traversal API
   * in `engine/location.ts` operate over this map. Rebuilt on load, not derived during
   * the sim — no sim system reads it yet, so it does not affect determinism.
   */
  locations: Map<LocationId, Location>;
  /** allocator for generic (non-settlement) location ids. Starts at settlements.length
   *  (settlement ids are dense 0..N-1, created only at worldgen) so the two never collide. */
  nextLocationId: LocationId;
  /** derived index: parent id → its children's ids, kept in ascending id order for
   *  deterministic traversal. Maintained by engine/location.ts; rebuilt on load. */
  childrenByParent: Map<LocationId, LocationId[]>;
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

  /** Live entities (alive actors), in creation (id) order. Dead actors are moved to
   *  deadEntities on kill so fullActors/summaryActors never scan past them. */
  entities: EntityId[];

  /** Actors that have died naturally — kept for the UI roster and the determinism
   *  hash but excluded from every live simulation scan. In death-time order. */
  deadEntities: EntityId[];

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
  /** per-actor INNATE personality: cultural VALUES (what they care about) + individual
   *  TEMPERAMENT (how they behave), fixed at birth from culture + traits + id-seeded
   *  deviation (see world.createActor). Stored — not re-derived from a mutable home — so
   *  it is stable for life and survives a save/load identically. Read via personalityOf. */
  personality: Map<EntityId, { values: Record<string, number>; temperament: Record<string, number> }>;
  profession: Map<EntityId, string>;
  ties: Map<EntityId, SocialTies>;
  memory: Map<EntityId, EventId[]>; // bounded recent events per actor
  /** per-actor public standing as witness-weighted, decaying marks (reputation.ts).
   *  Minted by perception when a deed is seen, so notoriety is earned, not assumed. */
  reputation: Map<EntityId, Reputation>;
  /** per-actor religious faith: the id of the deity they follow, or '' if faithless.
   *  Assigned at birth from the settlement's patron deity + trait-modified probability;
   *  stored (not re-derived) so faith is stable for life and survives a save/load. */
  faith: Map<EntityId, string>;
  /** The active factional split in the focused settlement. Recomputed yearly by
   *  factionYearly; not serialized — derived from world.personality on reload. */
  factionSplit?: FactionSplit;
  /** Actors who have been formally expelled from their home settlement.
   *  Keyed by actor id. Serialized — needed by Stage 3 (exile-and-return). */
  exiles: Map<EntityId, ExileRecord>;
  rels: Map<EntityId, Map<EntityId, RelEdge>>;

  /** Recent events (last ~10 years). Append-only within the window; compacted yearly.
   *  The first event in this array always has id === firstEventId. */
  events: WorldEvent[];
  /** ID of the first event currently in world.events (1 when no compaction has run yet). */
  firstEventId: number;
  /** Referenced old events pruned from world.events but kept because annals/chronicle/
   *  memory or a cause-chain still points at them. Serialized. */
  eventArchive: Map<EventId, WorldEvent>;
  /** Running tallies incremented in emit() — avoids an O(events) scan per UI render. */
  stats: { born: number; died: number; marriages: number; feuds: number };
  /** Reverse index: subject entity → event IDs it appears in. Maintained by emit() so
   *  inspectActor/inspectFigure/inspectSettlement are O(actor_events) not O(all_events).
   *  Derived — rebuilt from world.events + eventArchive on load, never serialized. */
  eventsBySubject: Map<EntityId, EventId[]>;
  /** Reverse index: settlement → event IDs that reference it. Maintained by emit() when
   *  settlementRefs are passed; rebuilt from world.events + eventArchive on load, never
   *  serialized. */
  eventsBySettlement: Map<SettlementId, EventId[]>;

  /** Rolling living memory: recent notable events, bounded and FADING. Drives the
   *  Director's sense of recent drama. */
  chronicle: Tale[];
  /** Permanent recorded history — the most momentous events of ALL time, plus
   *  landmark foundings/ruins. Bounded but does NOT fade, so a deep pre-play past
   *  survives for the player to inherit. Feeds the named ages & legends. */
  annals: Tale[];
  /** ID of the last event that chronicleYearly has already processed (0 = none yet).
   *  Stored as an event ID (not an array index) so it survives compaction intact. */
  chronicleCursor: number;

  /** The AI Director — paces drama by reading state and firing incidents. */
  director: DirectorState;
  /** dedicated RNG stream for the director (independent of focus). */
  directorRngState: number;

  /** Named people the world remembers (founders, rulers) — the legends database. */
  figures: HistoricalFigure[];
  /** O(1) lookup: figure id → record. Maintained alongside figures[]; never serialized. */
  figuresById: Map<FigureId, HistoricalFigure>;
  /** O(1) lookup: settlement id → figure ids for that settlement. Maintained alongside
   *  figures[]; never serialized; rebuilt on load. */
  figuresBySettlement: Map<SettlementId, FigureId[]>;
  /** The great Houses — lineages that hold seats and endure across generations. */
  houses: House[];
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
  /** a short, legible reading of this actor's personality (their strongest value
   *  leanings) — e.g. "honourable, peaceable". Derived from their value profile. */
  nature: string;
  /** this actor's House — their family lineage (surname). */
  house: string;
  spouse?: EntityId;
  relationshipCount: number;
  /** public standing in the community (0 = unremarked, − = notorious, + = renowned).
   *  Earned from witnessed deeds — see reputation.ts / perception.ts. */
  standing: number;
  /** deity name this actor follows, or undefined if faithless. */
  faith?: string;
  /** which faction this actor belongs to, or undefined if no split is active or the
   *  actor has no personality record (summary actors, minted figures). */
  factionName?: string;
  /** If this actor was exiled, the name of the settlement they were expelled from. */
  exiledFrom?: string;
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
  /** how memorable this event is (0 = routine chitchat … 70+ = a landmark of the age).
   *  Lets the feed curate by signal instead of dumping every banal happening. */
  interest: number;
  /** does this event concern the FOCUSED settlement? (so the player can always follow
   *  their own place, and scope the feed to it). */
  local: boolean;
  /** does this event involve the player's actor? (always surfaced, so their thread is legible). */
  involvesPlayer: boolean;
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
  house?: string; // the lineage this figure belongs to
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
  nameMeaning?: string; // "the iron hold" — the name's sense in the founders' tongue
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
  culturalTaboos: string[]; // deed labels this culture especially abhors (ethics weight ≥ 1.5)
  patronDeity: { name: string; domain: string }; // the culture's patron deity
  founder?: string; // who founded it
  ruler?: string; // who rules it now (or last, if a ruin)
  // economy
  specialization: Specialization;
  wealth: number;
  subsistenceSecurity: number; // stock[SUBSISTENCE_RESOURCE] / population => years of staple buffer
  prices: Record<ResourceKey, number>;
  /** Active faction split in this settlement (only populated for the focused settlement). */
  factionSplit?: { axis: string; highName: string; lowName: string };
  /** Year the civil war clock started (from a contested_succession event).
   *  Defined only for the focused settlement while a clock is active. */
  civilWarYear?: number;
}

export interface MapNodeView {
  id: SettlementId;
  name: string;
  nameMeaning?: string; // "the iron hold" — shown on hover
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
  house?: string; // the lineage this figure belongs to
}

/** A great House for the dashboard's dynasties panel — a legible family saga at a glance. */
export interface HouseView {
  name: string;
  foundedYear: number;
  prestige: number;
  origin: string; // the settlement where the line began
  seat?: string; // the settlement it rules now (absent if out of power)
  rulers: number; // how many of its members have held a seat — the depth of the dynasty
  extinctYear?: number; // the year it fell with its seat
}

export interface DirectorView {
  personality: string;
  label: string;
  tension: number; // 0..200
  incidents: number;
  mood: string; // "calm" | "building tension" | "stirring the pot" …
  options: { id: string; label: string }[]; // selectable personalities
}

/** An action the player can choose this turn (mirrors the open Intent vocabulary; the
 *  set of actions is pack data — see content/actions.ts). */
export interface PlayerActionView {
  kind: string;
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
  houses: HouseView[]; // the great Houses, ranked by prestige — dynasties as family sagas
  player?: PlayerView; // the controlled actor's actionable state, if any
}

export interface ActorDetail {
  actor: ActorView;
  relationships: RelationView[];
  lifeEvents: EventView[];
  /** how the community regards this actor: a standing score plus the witnessed deeds
   *  behind it ("shed blood", "a public kindness") — reputation made legible. */
  reputation: { standing: number; reasons: { label: string; value: number }[] };
}

export interface EventChain {
  root: EventView;
  ancestors: EventView[]; // flattened causal ancestors, newest cause first
}
