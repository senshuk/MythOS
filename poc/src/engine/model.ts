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

/**
 * MARK — the substrate of subjectivity (see engine/mark.ts and design/11 §Constructs).
 * The lifecycle fields shared by every sourced, decaying assertion an entity holds: a
 * `kind`, a birth tick, an optional expiry, and a `cause`. Payload — value, witnesses,
 * confidence, an assertion — lives in the EXTENDING interface. The substrate never sees
 * it. A Mark can be false; an Event cannot.
 */
export interface Mark {
  kind: string;
  sinceTick: number;
  expiresTick?: number; // undefined = permanent
  cause?: EventId; // the event that produced it (legibility)
}

/** A sourced, decaying opinion mark on a relationship edge (payload: a signed value). */
export interface Thought extends Mark {
  kind: ThoughtKind;
  value: number; // opinion delta (+/-)
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
export interface ReputeMark extends Mark {
  kind: string; // open id; the SET is pack data (content/fixture REPUTE_SPECS)
  value: number; // standing delta (+/-)
  witnesses: number; // how many saw it — scales how widely it is known
}

/** An actor's public reputation: a bounded list of sourced marks. */
export interface Reputation {
  marks: ReputeMark[];
}

// ── Belief (Subjectivity 1A — see design/19-subjectivity-1a-belief-v1.md, engine/belief.ts) ──

/** How an actor came to a piece of Evidence. v1 has two producers; documents/inference later. */
export type EvidenceKind = 'witness' | 'testimony';

/**
 * A single sourced, (optionally) decaying piece of Evidence bearing on a proposition — the
 * belief layer's Mark. Payload: which way it cuts (`polarity`) and how strong it is (the two
 * confidence axes). A belief's confidence is DERIVED from a stack of these (belief.ts
 * computeBelief), never stored — the same discipline as Thought→opinion and ReputeMark→standing.
 */
export interface Evidence extends Mark {
  kind: EvidenceKind;
  polarity: 1 | -1; // supports (+1) or contradicts (-1) the belief's assertion
  observationConfidence: number; // [0,1] how direct/clear the sensing (a witness ≈ 1.0)
  sourceTrust: number; // [0,1] how far the holder trusts the source (self = 1.0)
}

/** What an actor holds true about ONE proposition: an evidence stack, reduced on demand.
 *  A Belief may be FALSE — it asserts what the holder thinks, not what the Event log records. */
export interface Belief {
  subject: EntityId; // v1: the entity the proposition is about (e.g. the king)
  assertion: string; // v1: a simple predicate (e.g. 'dead')
  evidence: Evidence[];
  lastUpdated: number;
}

/** The stance an actor takes on a proposition. Unknown is the baseline (no net evidence). */
export type Stance = 'true' | 'false' | 'unknown';
/** The DERIVED reading of a Belief: where it lands, and how sure the holder is. */
export interface BeliefState {
  stance: Stance;
  confidence: number;
}

/** The DERIVED reading of a STATUS belief (statusBelief.ts): who the holder believes occupies a
 *  slot, and how sure. `occupant` is undefined when no claimant is believed (vacant/contested). */
export interface StatusBelief {
  occupant: EntityId | undefined;
  confidence: number;
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

export type OrgId = EntityId; // shares the monotonic entity id space (like FigureId/HouseId)

/** An Organization's broad, engine-level CATEGORY — an open string, pack-defined
 *  ('political', 'economic', 'religious', 'military', …). The engine never enumerates
 *  these; a universe pack maps its concrete kinds (kingdom, guild, church) onto a
 *  category. Distinct from `subtype`, which is the pack's display label. */
export type OrgCategory = string;

/**
 * An ORGANIZATION — a persistent collective entity that acts through a governance
 * structure (constitution `design/11`, `design/12`). The enduring actor of civilization:
 * a kingdom, guild, church, company, fleet. Deliberately SMALL at this stage (Phase 2A):
 * it EXISTS — it has identity, a category, governance (a leader), a seat, reputation
 * (via the shared reputation map), and a history (via events). It does NOT yet hold
 * goals, a treasury, or relationships — those are later stages.
 *
 * Crucially, an Organization's identity is INDEPENDENT OF GEOGRAPHY: its seat can move
 * (seatHistory records the line of seats) and the place it occupies can fall, while the
 * Organization — and its history — endure. The settlement HOSTS the organization; it is
 * not the organization.
 */
export interface Organization {
  id: OrgId;
  name: string;
  /** engine-level category (open string; e.g. 'political'). */
  category: OrgCategory;
  /** pack display label for this kind ('kingdom', 'tribe', 'republic', …). */
  subtype: string;
  foundedYear: number;
  /** the year the organization was dissolved (seat razed, membership lost); absent while
   *  it endures. Like a ruin, a dissolved org keeps its identity and history. */
  dissolvedYear?: number;
  /** the governance MODEL — reuses the pack's government ids (monarchy/council/…); it
   *  answers "who speaks for this organization?" via the succession rule. */
  governanceId: string;
  /** the figure who currently leads/speaks for the organization, if any. */
  leaderId?: FigureId;
  /** the Location that is currently the organization's seat (HQ/throne/temple), if any. */
  seatId?: LocationId;
  /** the line of seats this organization has held, oldest first — so a moved capital or a
   *  fallen seat leaves a coherent trail. The current seatId is appended here on a move. */
  seatHistory: LocationId[];
}

/**
 * A role an actor holds within an organization — the unit of an org's INSTITUTIONAL MEMORY
 * (Phase 2B). The org REMEMBERS who held which role and when, so a record is closed
 * (untilTick set) rather than deleted when the role ends. `role` is an open, pack-defined
 * string — the head office of a polity is the 'leader' role; a guild might use 'master'.
 * NB: this is the roster of NOTABLE roles (leader, founder, office-holders), not the bulk
 * population — general membership stays DERIVED (organization.ts `membersOf`) to avoid the
 * synchronization burden of mirroring every resident.
 */
export interface OrgMember {
  actorId: EntityId;
  role: string;
  sinceTick: number;
  /** the tick the role ended (left, died, replaced); undefined while currently held. */
  untilTick?: number;
}

// ---- organizational reasoning (Phase 2C: Perception → Worldview → Intent) -----
// The engine provides the PIPELINE; the pack provides the VOCABULARY (worldview axes,
// candidate intents, scoring rules). Reasoning is bounded, deterministic, and — above all
// — explainable: an OrgIntent is a complete justification record, not an opaque verdict.

/**
 * One thing an organization KNOWS — a single perceived datum with how sure it is and where
 * it came from. `id` is a STABLE pack key ('food_security', 'neighbor_strength'), not an
 * English label: the UI/pack resolves the display text, so localization and universe packs
 * never depend on engine strings. Perception is bounded (only what the org could actually
 * know) and ephemeral (rebuilt each cycle; never a standing cache of the world).
 */
export interface PerceptionFact {
  id: string;
  value: number;
  confidence: number; // 0..1 — own facts ~1.0, neighbour estimates < 1.0
  source: string; // 'seat' | 'neighbor:<settlementId>' | 'event:<eventId>'
}

/** A pack-defined worldview axis ('expansionist', 'militaristic', 'mercantile', …). */
export type WorldviewAxis = string;
/** An organization's derived disposition — recomputed every cycle from member values,
 *  never stored long-term. */
export type Worldview = Record<WorldviewAxis, number>;

/** One weighted reason in an intent's justification. `id` is a stable key (not a label);
 *  `group` optionally buckets factors ('military', 'economy') so the justification renders
 *  collapsibly and can grow into a nested tree later without replacing this type. */
export interface IntentFactor {
  id: string;
  value: number;
  group?: string;
}

/**
 * The complete, serializable reasoning record behind an organization's current decision —
 * it answers all four questions from one object: what it KNOWS (perception), what VALUES
 * define it (worldview), what INTENT it chose (kind), and WHY (factors + score, with the
 * runner-up alternatives). `evaluatorVersion` stamps the scoring ruleset, so a save made
 * before a rebalance still explains itself.
 */
export interface OrgIntent {
  kind: string; // the chosen intent id
  score: number; // == sum of factors[].value
  worldview: Worldview;
  perception: PerceptionFact[];
  factors: IntentFactor[];
  alternatives: { kind: string; score: number }[];
  sinceTick: number;
  evaluatorVersion: number;
}

/**
 * A pack-defined candidate intent + how to score it. Mirrors `AspirationDef`: the pack
 * supplies the vocabulary and the scoring behaviour; the engine runs the pipeline and
 * records the justification. **The score function receives ONLY perception, worldview, and
 * the org's own record — never the World** — so reasoning cannot bypass the Perception
 * layer and reach into global state. (This bound is enforced by the signature itself.)
 */
export interface IntentDef {
  id: string;
  displayName: string;
  category: string;
  description: string;
  score(perception: PerceptionFact[], worldview: Worldview, org: Organization): IntentFactor[];
}

// ---- organizational execution (Phase 2D: Intent → Action → Outcome → History) -
// Reasoning is inert; EXECUTION turns the stored intent into a bounded action that can
// change the organization (never geography), with a feasibility gate, a pure outcome, and
// — only on a real outcome — a history Event. `resolve` decides; `applyEffects` mutates.

/** An organization's mutable OPERATIONAL condition — pack-keyed measures (strength,
 *  readiness, morale), the org analogue of actor Needs. Deliberately SEPARATE from the
 *  Organization record (which is identity-only): this is the state the behaviour layer
 *  moves. Named OperationalState, not "OrgState", because "state" is overloaded. */
export type OperationalState = Record<string, number>;

/**
 * A structured, inspectable description of a SINGLE mutation an action will cause — data
 * you can read before it is applied (like the reasoning justification tree). The executor's
 * `applyEffects` is the only code that interprets these; an action's `resolve` only
 * DESCRIBES them. Effects touch the org's operational stats, its seat's existing economy/
 * demographics, adjacent edges, or its reputation — never geography.
 */
export type OrgEffect =
  | { target: 'stat'; key: string; delta: number } // an operational stat
  | { target: 'wealth'; delta: number } // the seat's econ.wealth
  | { target: 'treasury'; delta: number } // the org's own funds (2C: OrgResources)
  | { target: 'stability'; delta: number } // the seat's macro.stability
  | { target: 'relation'; neighbourId: SettlementId; delta: number } // an edge's relation
  | { target: 'reputation'; kind: string }; // an org reputation mark

/** The PURE result of resolving an action: whether it succeeded, what it would change, and
 *  how it reads — with NO mutation performed. The executor applies the effects and emits
 *  the event separately. (A feasible attempt that reality defeats has success=false and no
 *  effects — still history: "attempted, failed".) */
export interface OrgOutcome {
  success: boolean;
  effects: OrgEffect[];
  summary: string;
  eventType: string;
  eventData: Record<string, number | string>;
}

/** The org's last executed action, for the inspector — carries the applied effects so the
 *  UI can show exactly what changed. */
export interface OrgAction {
  id: string;
  intentKind: string;
  outcome: 'success' | 'failure';
  effects: OrgEffect[];
  summary: string;
  sinceTick: number;
}

/**
 * A pack-defined candidate ACTION + how to attempt it. Mirrors `IntentDef`: the pack
 * supplies the vocabulary and behaviour; the engine runs the pipeline. `feasible` is the
 * "can I do it?" gate (an infeasible attempt is NOT history). `resolve` is PURE — it
 * decides the outcome and describes the effects but mutates nothing; the engine applies and
 * emits. An action reads only the org, its operational state, its seat, and adjacent edges.
 */
export interface ActionDef {
  id: string;
  displayName: string;
  description: string;
  feasible(world: World, org: Organization, state: OperationalState): { ok: boolean; reason?: string };
  resolve(world: World, org: Organization, state: OperationalState): OrgOutcome;
}

// ---- organizational interaction (Phase 2E: Proposal → Evaluation → Outcome) ---
// Organizations never modify each other directly (design/16). All org↔org change flows
// through a negotiated pipeline: A DESCRIBES a proposal as data; B evaluates it through
// ITS OWN bounded perception/worldview/stance (never a global truth); a pure resolver
// describes the outcome's effects per party; the engine applies them and emits ONE event
// that both parties' histories cite. The engine understands only proposal→evaluation→
// outcome; what an "alliance" or a "tribute" IS lives in the pack (INTERACTIONS).

/** A structured, inspectable OFFER from one organization to another — data, never a
 *  mutation. `kind` is a pack interaction id; `terms` its pack-defined particulars
 *  (a tribute amount, a pact duration). Ephemeral — resolved the year it is made. */
export interface InteractionProposal {
  kind: string;
  from: OrgId;
  to: OrgId;
  terms: Record<string, number | string>;
  sinceTick: number;
}

/** One effect of an interaction outcome, tagged with WHICH party it lands on — the
 *  two-party analogue of OrgEffect (and applied by the same applyEffects mutator). */
export interface PartyEffect {
  party: 'from' | 'to';
  effect: OrgEffect;
}

/** The PURE result of resolving a proposal: whether it was accepted, what it changes on
 *  each side, and how EACH party remembers it (two histories from one event). */
export interface InteractionOutcome {
  accepted: boolean;
  effects: PartyEffect[];
  /** a standing agreement this outcome seals (engine stores it; pack only DESCRIBES). */
  agreement?: { kind: string; years: number };
  summaryFrom: string; // how the proposer's history reads it ("secured tribute from X")
  summaryTo: string; // how the recipient's history reads it ("submitted to X's demand")
  eventType: EventType;
  eventData: Record<string, number | string>;
}

/** A standing AGREEMENT two organizations sealed — the persistent residue of an accepted
 *  proposal. Engine-neutral: the engine only stores/expires these; which kinds exist and
 *  what they change (a raid suppressed, a trade route favoured) is pack + system hooks. */
export interface OrgAgreement {
  kind: string;
  a: OrgId; // lower org id (normalized, like RegionEdge)
  b: OrgId;
  sinceTick: number;
  expiresTick: number;
}

/** How an organization remembers its most recent interaction — ITS OWN side of the story
 *  (the proposer and the recipient hold different records citing the same event). */
export interface OrgInteractionRecord {
  kind: string;
  withOrg: OrgId;
  role: 'proposer' | 'recipient';
  accepted: boolean;
  summary: string;
  sinceTick: number;
  eventId: EventId;
}

/**
 * A pack-defined interaction type + how to negotiate it. Mirrors IntentDef/ActionDef: the
 * pack supplies the vocabulary and behaviour, the engine runs the pipeline. `propose` and
 * `outcome` follow the ActionDef precedent (they may read the world to describe, never to
 * mutate); **`evaluate` is signature-bounded like IntentDef.score** — it receives only the
 * recipient's OWN perception, worldview, and institutional stance toward the proposer, so
 * a recipient can never assess a deal against global truth (design/16 principle 3).
 */
export interface InteractionDef {
  id: string;
  displayName: string;
  description: string;
  /** Should `from` propose this now, and to whom? The engine supplies the candidate
   *  neighbour polities (region-graph order); the pack picks a target + terms or declines. */
  propose(
    world: World,
    from: Organization,
    candidates: Organization[],
  ): { to: OrgId; terms: Record<string, number | string> } | undefined;
  /** The recipient's PURE evaluation. A positive factor sum accepts the proposal. */
  evaluate(
    perception: PerceptionFact[],
    worldview: Worldview,
    stance: number,
    terms: Record<string, number | string>,
    from: Organization,
  ): IntentFactor[];
  /** PURE outcome description for both the accepted and refused paths — engine applies. */
  outcome(
    world: World,
    from: Organization,
    to: Organization,
    terms: Record<string, number | string>,
    accepted: boolean,
  ): InteractionOutcome;
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

/** Whether a Location can move. A Vehicle in the ontology is simply a Location with
 *  mobility='mobile'. Only a mobile Location may enter transit (see Transit). */
export type Mobility = 'fixed' | 'mobile';

/**
 * The transit state of a mobile Location currently travelling between two world positions.
 * Travel has DURATION (constitution `design/13` "Travel is an action … not a teleport"):
 * the location occupies `fromPos` at departTick and `toPos` at arriveTick, and may be
 * delayed by hazards in between. Resolved deterministically each tick by engine/travel.ts.
 */
export interface Transit {
  fromPos: WorldPosition;
  toPos: WorldPosition;
  /** the Location the journey ends at (a dock/berth), if the destination is a place. */
  toLocationId?: LocationId;
  departTick: number;
  arriveTick: number;
  /** per-tick chance (0..1) of a hazard delaying the journey; 0 = a safe route. At most
   *  one mishap occurs per journey, so a high hazard cannot strand the vehicle forever. */
  hazard: number;
  /** ticks of delay a hazard has added (0 until a mishap strikes; gates further rolls). */
  delayTicks: number;
}

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

/**
 * A player's committed AMBITION — a long-horizon goal the player CHOSE (unlike an aspiration, which
 * is derived and handed to them). It is the player's private steering layer: the world records
 * DEEDS (a marriage, a killing) through the normal event system; the ambition is only the player's
 * interpretation of WHY. So it is serialized for continuity but is NOT part of the simulation hash
 * and is read by no NPC decision or RNG draw — choosing one cannot affect determinism. Fulfilment
 * emits no shared event in v1 (the constituent deeds already entered history).
 */
export interface PlayerAmbition {
  id: string; // a pack ambition id (content/ambitions.ts)
  target?: EntityId;
  chosenTick: number;
  completedTick?: number;
  outcome?: 'fulfilled' | 'thwarted';
}

/**
 * PACK DATA contract: a KIND of life-ambition this universe offers a player. The engine
 * (engine/ambition.ts) owns only the mechanism (offer, commit, review, surface the next step); the
 * SET of ambitions is universe-specific, like the aspiration ladder and decision set. Every method
 * is a PURE READ over world state — an ambition never mutates the world. The `nextStep` must be
 * GAP-DERIVED (what current state lacks vs `fulfilled`), never a scripted stage chain: obstacles
 * come from the simulation.
 */
export interface AmbitionDef {
  id: string;
  /** Worth OFFERING to this player right now, given their real situation? (with a target if any). */
  offerable(world: World, playerId: EntityId): { target?: EntityId } | undefined;
  label(world: World, playerId: EntityId, target?: EntityId): string;
  hint(world: World, playerId: EntityId, target?: EntityId): string;
  /** The current emergent step, framed as a decision (undefined = nothing to do but let time pass). */
  nextStep(world: World, playerId: EntityId, target?: EntityId): DecisionView | undefined;
  /** A one-line progress note ("Elara is fond of you; her father is not"). */
  note(world: World, playerId: EntityId, target?: EntityId): string;
  fulfilled(world: World, playerId: EntityId, target?: EntityId): boolean;
  /** Became permanently unreachable (target dead/wed elsewhere) → thwarted, not stuck. */
  impossible?(world: World, playerId: EntityId, target?: EntityId): boolean;
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
   *  place from its parent rather than hold its own coordinate. For a mobile Location this
   *  is MUTABLE — it is updated on arrival from a journey (see engine/travel.ts). For a
   *  fixed Location it is immutable. */
  pos?: WorldPosition;
  /** present while a mobile Location is en route between two positions. Absent when at
   *  rest. Only a mobility='mobile' Location may have a transit. */
  transit?: Transit;
  /** the Location this (mobile) one is currently docked at — adjacent with a permeable
   *  boundary, not contained. Set on arrival at a destination place; cleared on departure. */
  dockedAt?: LocationId;
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
  /** the named geographic feature this settlement sits beside (its sense of place —
   *  "on the shores of the Skarnald"), resolved at founding from the substrate. Absent
   *  for inland sites near nothing notable, and for non-surface worlds. */
  landmark?: { name: string; kind: string; relation: string };
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
  /** the contested_succession event that started the clock — so a resulting civil war can
   *  trace its cause ("why?"). Cleared with civilWarTick. Serialized with the settlement. */
  civilWarCause?: number;
  /** how much population this site's LAND can sustain — a multiplier on base carrying
   *  capacity, from local fertility/water/coast. Generous land grows great cities. */
  capacity: number;
  /** the figure who currently rules here (founder, then a line of successors). Absent
   *  in a leaderless polity (government with no leader). NB: from Phase 2A this is a
   *  compatibility MIRROR of the hosting Polity's leaderId — the Organization owns
   *  governance now; the settlement merely hosts it. */
  currentRulerId?: FigureId;
  /** the governing Organization (a Polity) this settlement HOSTS, if it is governed.
   *  Absent for leaderless (freefolk) settlements. The settlement is the place; the
   *  polity is the government — see engine/organization.ts. */
  polityId?: OrgId;
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
  /** dedicated RNG stream for travel hazards (transit delays), isolated like the
   *  geo/director/player streams so transit randomness never perturbs other outcomes. */
  travelRngState: number;
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
  /** the MEANING of each House/lineage surname in its founders' tongue ("Korthan" → "the Iron
   *  Hand"), keyed by the surname. Derived flavour like a settlement's nameMeaning — serialized
   *  (it's cheap world data) but NOT in the determinism hash. */
  houseMeaning: Map<string, string>;
  lifecycle: Map<EntityId, Lifecycle>;
  needs: Map<EntityId, Needs>;
  /** per-actor SELF-THOUGHTS: sourced, decaying marks about one's OWN life (grief, joy,
   *  humiliation) — the same Thought machinery as relationship opinions, held on the self.
   *  Their diminishing sum + situational need-feelings + temperament = MOOD (mood.ts).
   *  Full-fidelity actors only (the LOD gate is addSelfThought). Serialized & hashed —
   *  mood steers NPC behaviour (mental breaks), unlike playerAmbition. */
  selfThoughts: Map<EntityId, Thought[]>;
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
  /** per-actor BELIEFS: what each holder holds true about propositions, as evidence stacks
   *  reduced on demand (belief.ts). The subjective layer — a belief may diverge from, or
   *  contradict, the objective Event log. Keyed by holder; one Belief per (subject, assertion).
   *  Written by acquireEvidence (inert — never emits, per invariant 8). Serialized. */
  beliefs: Map<EntityId, Belief[]>;
  /** The reaction system's memory (reactions.ts): which `actor|kind|subject|assertion`
   *  belief-triggered reactions have already fired, so each runs ONCE when a stance first
   *  crosses to believed. Kept OUT of Belief on purpose — belief is knowledge, reacting is
   *  behaviour (Belief ≠ Reaction, as Intent ≠ Action). Serialized. */
  reactions: Set<string>;
  /** THE NEWS FRONTIER (Subjectivity 1C-distal; design/20 & news.ts) — OBJECTIVE transport state,
   *  not belief. Per (observer settlement, subject) it records the tick at which word of an event
   *  ARRIVES there, propagated across the map at travel speed. It exists whether or not anyone is
   *  simulated to believe it; minds convert it to Evidence where they exist. ONLY the propagation
   *  system writes it (never a reducer, consumer, or focus change). Serialized. */
  newsFront: Map<string, { ruler: EntityId; arrival: number }>;
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
  /** First-class Organizations — the enduring collective actors (polities today;
   *  guilds/churches later). In creation (id) order. */
  organizations: Organization[];
  /** O(1) lookup: org id → record. Maintained alongside organizations[]; rebuilt on load. */
  organizationsById: Map<OrgId, Organization>;
  /** per-organization roster of role-tagged, time-stamped memberships — the org's
   *  institutional memory (current + closed records). Keyed by org id. */
  orgMembers: Map<OrgId, OrgMember[]>;
  /** the CURRENT reasoning record per organization — what it decided this evaluation
   *  cycle and why. Recomputed yearly (orgReason.ts). Named `currentIntent` to leave room
   *  for an intent-history layer later. */
  currentIntent: Map<OrgId, OrgIntent>;
  /** per-organization mutable operational condition (strength/readiness/morale), moved by
   *  the execution layer (orgAction.ts). Seeded at founding. */
  operationalState: Map<OrgId, OperationalState>;
  /** the last action each organization executed — its outcome + applied effects, for the
   *  inspector. Set by orgAction.ts. */
  lastAction: Map<OrgId, OrgAction>;
  /** per-organization TREASURY (2C: OrgResources) — institutional funds, kept OFF the
   *  identity-locked Organization record like operationalState. Filled by the yearly
   *  tithe on the seat's economy (a real transfer, never minted); spent by the action
   *  layer (an action's 'treasury' effects). */
  orgTreasury: Map<OrgId, number>;
  /** standing AGREEMENTS between organizations (2E) — the persistent residue of accepted
   *  proposals, normalized a<b like region edges. Expired entries are pruned yearly. */
  orgAgreements: OrgAgreement[];
  /** each org's memory of its most recent interaction — its OWN side of the story (the
   *  two-histories principle: proposer and recipient keep different records, one event). */
  lastInteraction: Map<OrgId, OrgInteractionRecord>;
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
  /** The player's committed long-horizon ambition, if any. Player-facing STEERING state: serialized
   *  for save/load continuity but excluded from the simulation hash and read by no NPC/RNG — see
   *  PlayerAmbition. Undefined = the player has chosen no ambition (or is just living). */
  playerAmbition?: PlayerAmbition;
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

/** An organization's current reasoning, made legible for the inspector — the answer to
 *  "what does it know / what values define it / what intent did it choose / why". Labels
 *  are resolved from stable ids for display. */
export interface OrgIntentView {
  worldview: string; // top leanings, e.g. "expansionist, militaristic"
  intent: string; // chosen intent's display name
  intentDescription: string;
  score: number;
  factors: { label: string; value: number; group?: string }[]; // the justification
  alternatives: { label: string; score: number }[]; // runner-up intents and their scores
  perception: { label: string; value: number; confidence: number }[]; // what it knows
}

export interface SettlementView {
  id: SettlementId;
  name: string;
  nameMeaning?: string; // "the iron hold" — the name's sense in the founders' tongue
  /** the named landmark it sits beside ("on the shores of the Skarnald") — sense of place. */
  landmark?: { name: string; kind: string; relation: string };
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
  /** the creed's moral character (design/23): the deeds & lives it reveres / abhors. */
  creed: { reveres: string[]; abhors: string[] };
  patronDeity: { name: string; domain: string }; // the culture's patron deity
  founder?: string; // who founded it
  ruler?: string; // who rules it now (or last, if a ruin)
  /** the Organization (a Polity) this settlement hosts, if it is governed — the
   *  government as a first-class entity, distinct from the place. `founderName` and
   *  `leaderCount` expose the org's institutional memory (its remembered line of leaders).
   *  `reasoning` is its current decision made legible (focused settlement only). */
  polity?: {
    name: string;
    subtype: string;
    leaderName?: string;
    founderName?: string;
    leaderCount: number;
    standing: number;
    /** the org's TREASURY (2C: OrgResources) — the tithe-fed funds its actions spend. */
    treasury: number;
    reasoning?: OrgIntentView;
    /** the org's operational condition (strength/readiness/morale) — the state the
     *  execution layer moves. */
    operational?: Record<string, number>;
    /** the last action the org executed, made legible. */
    lastAction?: { summary: string; outcome: string; year: number };
    /** standing agreements this polity holds (2E), made legible. */
    agreements: { kind: string; with: string; untilYear: number }[];
    /** this org's OWN memory of its last negotiation (two histories, one event). */
    lastInteraction?: { summary: string; year: number };
  };
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
  meaning?: string; // the surname's sense in the founders' tongue ("the Iron Hand")
  foundedYear: number;
  prestige: number;
  origin: string; // the settlement where the line began
  seat?: string; // the settlement it rules now (absent if out of power)
  rulers: number; // how many of its members have held a seat — the depth of the dynasty
  extinctYear?: number; // the year it fell with its seat
}

/** A living culture's TONGUE, made explorable — its self-name, its sound, its kin (the
 *  language family it drifted from), a sample of its lexicon, and towns that carry it.
 *  Pure presentation of the pack's philology (content/languages); nothing here is stored. */
export interface TongueView {
  cultureId: string;
  demonym: string; // the people's own name for themselves ("the Rodadra")
  voice: string; // the character of its sound ("guttural", "flowing", …)
  kin: string[]; // culture ids that share its mother tongue (empty = an isolate)
  lexicon: { root: string; gloss: string }[]; // a learnable sample: root = meaning
  towns: { name: string; meaning?: string }[]; // living settlements that speak it
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
/** One beat in the player's life story — a narrated moment, with clickable links and an optional
 *  note about HOW the player came to know it (the seam where belief explains behaviour: "word
 *  reached you 19 days later"). Presentation only — built by the snapshot, never stored. */
export interface StoryBeat {
  year: number;
  parts: EventPart[];
  tone: string; // the event type, reused for colouring
  note?: string; // e.g. "you were there" · "word reached you 19 days later"
}

/** A live, UNRESOLVED thread the player can anticipate — a bond warming, word on the road, a
 *  need at risk. Present tense, changes every tick; this is what makes "Advance" worth pressing. */
export interface Tension {
  icon: string;
  text: string;
  ref?: EventRef;
  /** the epistemic weight of the line, when it is a piece of the player's knowledge: something
   *  KNOWN for certain, an absence of knowledge (news not yet arrived), a CONTESTED claim, or a
   *  RUMOR. Lets presentation separate certainty from uncertainty (design/21 §4). */
  certainty?: 'known' | 'unknown' | 'contested' | 'rumor';
}

/** How one need FEELS right now — the lived word ("Lonely", "Comfortable") plus a coarse tone,
 *  translated from the engine's raw value in the snapshot. Presentation, not simulation. */
export interface NeedFeel {
  key: string;
  feel: string;
  tone: 'bad' | 'warn' | 'good';
  value: number; // 0..1000, kept for the title/tooltip
}

/** A person who matters to the player — an anchor, so when the world says "Rowan heard first"
 *  the player already cares. */
export interface CastMember {
  icon: string;
  role: string;
  status: string; // a live one-line state ("content" · "legitimacy uncertain" · "your rival grows") — turns a name into a character
  kind: 'actor' | 'figure'; // how to inspect them (a co-resident vs a remembered ruler)
  id: EntityId;
  name: string;
  note: string;
}

/** One choice within a Decision — a labelled option mapped to the Intent it enacts. Picking it
 *  flows through the ordinary player-turn input log (no special code path), so the whole decision
 *  layer adds ZERO world state and cannot affect determinism. */
export interface DecisionOptionView {
  label: string;
  hint?: string;
  intent: Intent;
  tone?: string; // 'good' | 'bad' | 'neutral' — colour only
}

/** A framed choice the world is presenting the player RIGHT NOW — a turning point, not a standing
 *  menu. Derived purely from world state at snapshot time (like tensions and aspirations), never
 *  stored: a reactive decision keys off events of the past week and ages out on its own; a standing
 *  one persists only while its state holds. */
export interface DecisionView {
  id: string;       // stable per situation, e.g. `insult:${otherId}` (React key; not persisted)
  urgency: number;  // higher = more pressing; sorts the list and drives visual emphasis
  prompt: EventPart[];
  options: DecisionOptionView[];
}

/**
 * PACK DATA contract: a KIND of situation the world can present to the player as a framed choice.
 * The engine (engine/decision.ts) evaluates every def and surfaces the most pressing few; the SET
 * of situations is universe-specific (content/decisions.ts), exactly like the aspiration ladder and
 * the action vocabulary. `evaluate` is a PURE READ — it must not emit or mutate.
 */
export interface DecisionDef {
  id: string;
  /** Zero or more choices this situation currently presents to `playerId` (empty if inapplicable). */
  evaluate(world: World, playerId: EntityId): DecisionView[];
}

/** The player's committed ambition as the UI sees it: its label, a live progress note, and its
 *  current emergent STEP (a decision). Once resolved, `outcome` is set for a closing beat. */
export interface ActiveAmbitionView {
  id: string;
  label: string;
  targetName?: string;
  note: string;
  step?: DecisionView;
  outcome?: 'fulfilled' | 'thwarted';
}

/** An ambition the world is OFFERING the player to commit to, derived from their situation. */
export interface AmbitionOffer {
  id: string;
  label: string;
  hint: string;
  target?: EntityId;
  targetName?: string;
}

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
  /** each need as a lived word + tone (design/21 §5) — presentation of `needs`, shown in the journal. */
  needFeels: NeedFeel[];
  /** MOOD — how this life feels overall (0..1000, 500 neutral), as a number, a lived
   *  word ("Weary"), and the legible reasons behind it (mood.ts). The RimWorld pillar. */
  mood: { value: number; word: string; reasons: { label: string; value: number }[] };
  /** the single most pressing drive, phrased as a narrative beat ("Hunger is beginning to gnaw at
   *  you.") and folded into the Current Situation instead of a row of meters. Omitted when nothing
   *  is notable. */
  bodyNote?: string;
  // the actor's current drive (a goal). `suggested` is the one-click action that
  // pursues it, when the goal points at a concrete action/target.
  aspiration: {
    kind: string;
    label: string;
    targetName?: string;
    suggested?: Intent;
    /** goal-as-diagnosis: the situation read as a narrator would ("People know your name, but it
     *  has not spread far enough. Aeriril still holds the seat."), the best thing to do about it,
     *  and a rough sense of how far along — written from inside the player's head, never a quest. */
    obstacle?: string;
    nextStep?: string;
    progress?: number; // 0..1, coarse; omitted when not meaningfully measurable
  };
  /** rendered text of a recently-fulfilled goal, for a transient celebration. */
  lastAchieved?: string;
  actions: PlayerActionView[];
  targets: PlayerTargetView[];
  /** the player's life told as a linked, chronological story (life events + losses they've come
   *  to know of, annotated with how the news reached them). */
  story: StoryBeat[];
  /** ONE feed — WHAT DESERVES MY ATTENTION. People, changes, openings and worries merged and
   *  sorted by importance, notification-style (design/21 §7). The cockpit's second question; the
   *  categorized lists below are its full-detail drill-down, kept for the journal. */
  attention: Tension[];
  /** live unresolved threads — WHAT'S HAPPENING (present, changing every tick). */
  tensions: Tension[];
  /** openings the world is presenting — OPPORTUNITIES (what could I do?). */
  opportunities: Tension[];
  /** narrative worries — THREATS (what should I fear?). */
  threats: Tension[];
  /** WHAT YOU BELIEVE — the player's own subjective reality (who reigns, who's dead, what news
   *  has NOT reached them). Can diverge from the objective world, exactly like any NPC. */
  belief: Tension[];
  /** the small cast of people who matter to the player right now. */
  cast: CastMember[];
  /** DECISIONS — framed choices the world is putting to the player this week (a turning point,
   *  most-pressing first). Interactive: each option is an Intent taken through the normal turn. */
  decisions: DecisionView[];
  /** The player's committed AMBITION (long-horizon, self-chosen) + its current step, if any. */
  ambition?: ActiveAmbitionView;
  /** Ambitions the world offers the player to commit to (shown when none active, or after one
   *  resolves). Derived from the actor's situation — the player is never handed a fixed menu. */
  offeredAmbitions: AmbitionOffer[];
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
  tongues: TongueView[]; // the living cultures' languages, explorable (sound, kin, lexicon)
  player?: PlayerView; // the controlled actor's actionable state, if any
}

export interface ActorDetail {
  actor: ActorView;
  relationships: RelationView[];
  lifeEvents: EventView[];
  /** this actor's mood + the reasons behind it (mood.ts); absent below full fidelity. */
  mood?: { value: number; word: string; reasons: { label: string; value: number }[] };
  /** how the community regards this actor: a standing score plus the witnessed deeds
   *  behind it ("shed blood", "a public kindness") — reputation made legible. */
  reputation: { standing: number; reasons: { label: string; value: number }[] };
}

export interface EventChain {
  root: EventView;
  ancestors: EventView[]; // flattened causal ancestors, newest cause first
}
