/**
 * Save / load. "The save file is the world": this serializes *every* field of the
 * World to a plain, JSON-safe structure and rebuilds it exactly, so a loaded world
 * continues byte-identically to one that was never saved (see the persistence
 * determinism test). The hard parts this gets right:
 *
 *  - the `Rng` instance is stored as its integer cursor and rebuilt;
 *  - every component Map is stored as `[key, value]` entries;
 *  - the relationship graph shares ONE RelEdge object between both directions
 *    (a→b and b→a) — that invariant is preserved on load (store each undirected
 *    edge once, then point both directions at the same rebuilt object), otherwise
 *    a later thought added through one side would silently diverge the two copies.
 *
 * The format is versioned; bump SAVE_VERSION and add a migration when the shape
 * changes. Backward compatibility matters (CLAUDE.md "Save Philosophy").
 */
import { type World, type Identity, type Lifecycle, type Needs, type Thought, type SocialTies, type RelEdge, type Reputation, type Belief, type ExileRecord, type Location, type LocationId, type Organization, type OrgId, type OrgMember, type OrgIntent, type OperationalState, type OrgAction, type OrgAgreement, type OrgInteractionRecord, DAYS_PER_YEAR } from './model';
import { type Intent } from './intent';
import { Rng, mixSeed } from './rng';
import { createSubstrate } from './substrate';
import { POLITY_LABELS, ORG_CATEGORY_POLITICAL, baselineOperational } from '../content/fixture';

export const SAVE_VERSION = 21;

/** A fully serialized world — plain data only (JSON-safe & structured-clonable). */
export interface SaveFile {
  version: number;

  // scalars + RNG cursors
  seed: number;
  tick: number;
  rngState: number;
  geoRngState: number;
  travelRngState?: number; // optional for saves predating v10 (transportation)
  focusedSettlementId: number;
  nextEntityId: number;
  nextEventId: number;
  chronicleCursor: number;
  directorRngState: number;
  figureRngState: number;
  playerRngState: number;
  playerId: number | null;
  playerGoal: { kind: string; target?: number } | null;
  /** The player's committed ambition (steering state). Optional for saves predating v20. */
  playerAmbition?: { id: string; target?: number; chosenTick: number; completedTick?: number; outcome?: 'fulfilled' | 'thwarted' };

  // plain arrays / objects (already JSON-safe)
  settlements: World['settlements'];
  /** GENERIC (non-settlement) locations only — settlements are reconstructed into the
   *  location registry by reference from `settlements`, so they are not stored twice.
   *  Optional for saves predating v9 (the spatial foundation). Stored id-sorted. */
  locations?: Location[];
  /** allocator cursor for generic location ids. Optional for pre-v9 saves. */
  nextLocationId?: number;
  edges: World['edges'];
  entities: number[];
  deadEntities: number[];
  stats: { born: number; died: number; marriages: number; feuds: number };
  firstEventId: number;
  events: World['events'];
  /** Referenced old events that survived compaction, keyed by event ID. */
  eventArchive: [number, World['events'][number]][];
  chronicle: World['chronicle'];
  annals: World['annals'];
  director: World['director'];
  figures: World['figures'];
  houses: World['houses'];
  /** First-class organizations (plain objects). Optional for saves predating v11. */
  organizations?: Organization[];
  /** per-org membership rosters as entries. Optional for saves predating v12. */
  orgMembers?: [OrgId, OrgMember[]][];
  /** per-org current reasoning record as entries. Optional for saves predating v13;
   *  recomputed on the next yearly tick if absent. */
  currentIntent?: [OrgId, OrgIntent][];
  /** per-org treasuries (2C: OrgResources). Optional for saves predating v15 (default 0). */
  orgTreasury?: [OrgId, number][];
  /** standing agreements between orgs (2E). Optional for saves predating v16 (default none). */
  orgAgreements?: OrgAgreement[];
  /** each org's memory of its last negotiation (2E). Optional for pre-v16 saves. */
  lastInteraction?: [OrgId, OrgInteractionRecord][];
  /** per-org operational state + last action as entries. Optional for saves predating v14
   *  (operational state then defaults to baseline; lastAction empty). */
  operationalState?: [OrgId, OperationalState][];
  lastAction?: [OrgId, OrgAction][];
  playerInputs: { tick: number; intent: Intent }[];

  // component maps, as entries
  homeSettlement: [number, number][];
  fidelity: [number, World['fidelity'] extends Map<number, infer V> ? V : never][];
  identity: [number, Identity][];
  names: [number, string][];
  lifecycle: [number, Lifecycle][];
  needs: [number, Needs][];
  /** per-actor self-thoughts (mood memory). Optional for saves predating v21. */
  selfThoughts?: [number, Thought[]][];
  traits: [number, string[]][];
  personality: [number, { values: Record<string, number>; temperament: Record<string, number> }][];
  profession: [number, string][];
  ties: [number, SocialTies][];
  memory: [number, number[]][];
  reputation: [number, Reputation][];
  /** per-actor beliefs (Subjectivity 1A). Optional for saves predating v17 (default none). */
  beliefs?: [number, Belief[]][];
  /** fired belief-triggered reactions (Subjectivity 1B). Optional for saves predating v18. */
  reactions?: string[];
  /** the news frontier (Subjectivity 1C-distal). Optional for saves predating v19. */
  newsFront?: [string, { ruler: number; arrival: number }][];
  faith?: [number, string][]; // actor → deity id ('' = faithless); optional for v7 compat
  exiles?: [number, ExileRecord][]; // optional for saves pre-dating Stage 2

  // relationship graph. `relPool` holds each unique edge ONCE; `relAdj` lists, per
  // entity (in original order), its neighbours as [neighbourId, poolIndex]. This
  // preserves BOTH the shared-edge invariant (both directions point at one pooled
  // object) AND each actor's neighbour insertion order — which choosePartner's
  // `[...keys()][rng.int()]` selection depends on for determinism.
  relPool: RelEdge[];
  relAdj: [number, [number, number][]][];
}

/** Serialize a world into a plain, storable SaveFile. */
export function serializeWorld(world: World): SaveFile {
  // pool unique edges by object identity; record per-entity adjacency in order.
  const poolIndex = new Map<RelEdge, number>();
  const relPool: RelEdge[] = [];
  const relAdj: [number, [number, number][]][] = [];
  for (const [a, inner] of world.rels) {
    const list: [number, number][] = [];
    for (const [b, edge] of inner) {
      let idx = poolIndex.get(edge);
      if (idx === undefined) {
        idx = relPool.length;
        relPool.push(edge);
        poolIndex.set(edge, idx);
      }
      list.push([b, idx]);
    }
    relAdj.push([a, list]);
  }

  return {
    version: SAVE_VERSION,
    seed: world.seed,
    tick: world.tick,
    rngState: world.rng.state,
    geoRngState: world.geoRngState,
    travelRngState: world.travelRngState,
    focusedSettlementId: world.focusedSettlementId,
    nextEntityId: world.nextEntityId,
    nextEventId: world.nextEventId,
    chronicleCursor: world.chronicleCursor,
    directorRngState: world.directorRngState,
    figureRngState: world.figureRngState,
    playerRngState: world.playerRngState,
    playerId: world.playerId ?? null,
    playerGoal: world.playerGoal ?? null,
    playerAmbition: world.playerAmbition,

    settlements: world.settlements,
    // store only the generic locations; settlements re-enter the registry by reference on load.
    locations: (() => {
      const settlementIds = new Set(world.settlements.map((s) => s.id));
      return [...world.locations.values()]
        .filter((l) => !settlementIds.has(l.id))
        .sort((a, b) => a.id - b.id);
    })(),
    nextLocationId: world.nextLocationId,
    edges: world.edges,
    entities: world.entities,
    deadEntities: world.deadEntities,
    stats: world.stats,
    firstEventId: world.firstEventId,
    events: world.events,
    eventArchive: [...world.eventArchive],
    chronicle: world.chronicle,
    annals: world.annals,
    director: world.director,
    figures: world.figures,
    houses: world.houses,
    organizations: world.organizations,
    orgMembers: [...world.orgMembers],
    currentIntent: [...world.currentIntent],
    operationalState: [...world.operationalState],
    lastAction: [...world.lastAction],
    orgTreasury: [...world.orgTreasury],
    orgAgreements: world.orgAgreements,
    lastInteraction: [...world.lastInteraction],
    playerInputs: world.playerInputs,

    homeSettlement: [...world.homeSettlement],
    fidelity: [...world.fidelity],
    identity: [...world.identity],
    names: [...world.names],
    lifecycle: [...world.lifecycle],
    needs: [...world.needs],
    selfThoughts: [...world.selfThoughts],
    traits: [...world.traits],
    personality: [...world.personality],
    profession: [...world.profession],
    ties: [...world.ties],
    memory: [...world.memory],
    reputation: [...world.reputation],
    beliefs: [...world.beliefs],
    reactions: [...world.reactions],
    newsFront: [...world.newsFront],
    faith: [...world.faith],
    exiles: [...world.exiles],

    relPool,
    relAdj,
  };
}

/** Rebuild a live World from a SaveFile. Throws on an unsupported version. */
export function deserializeWorld(s: SaveFile): World {
  if (s.version < 5 || s.version > SAVE_VERSION) {
    throw new Error(`unsupported save version ${s.version} (engine expects ${SAVE_VERSION})`);
  }

  // v5 → v6: dead actors were stored in entities; split them out by alive status.
  let entities = s.entities;
  let deadEntities = (s as { deadEntities?: number[] }).deadEntities ?? [];
  if (s.version === 5) {
    const lifecycleMap = new Map(s.lifecycle);
    entities = s.entities.filter((id) => lifecycleMap.get(id)?.alive ?? true);
    deadEntities = s.entities.filter((id) => !(lifecycleMap.get(id)?.alive ?? true));
  }

  // v5/v6 → v7: stats were not stored; reconstruct by scanning events once at load time.
  let stats = (s as { stats?: { born: number; died: number; marriages: number; feuds: number } }).stats;
  if (!stats) {
    stats = { born: 0, died: 0, marriages: 0, feuds: 0 };
    for (const ev of s.events) {
      if (ev.type === 'born') stats.born++;
      else if (ev.type === 'died' || ev.type === 'died_brawl') stats.died++;
      else if (ev.type === 'married') stats.marriages++;
      else if (ev.type === 'feud') stats.feuds++;
    }
  }

  // rebuild the relationship graph: one pooled edge object is shared by both
  // directions, and each entity's neighbours are restored in their original order.
  const rels = new Map<number, Map<number, RelEdge>>();
  for (const [a, list] of s.relAdj) {
    const inner = new Map<number, RelEdge>();
    for (const [b, idx] of list) inner.set(b, s.relPool[idx]); // shared reference
    rels.set(a, inner);
  }

  const rng = new Rng(0);
  rng.state = s.rngState;

  // B: backfill founderName on settlements that predate the cached field (old saves).
  for (const st of s.settlements) {
    if (!st.founderName) {
      const f = s.figures.find((fig) => fig.role === 'founder' && fig.settlementId === st.id);
      if (f) st.founderName = f.name;
    }
  }

  // v8 → v9 (the spatial foundation): settlements gained the Location base fields. Pre-v9
  // settlements were flat, fixed places — backfill the defaults so each settlement is a
  // valid root Location. parentId stays undefined (no hierarchy existed before).
  for (const st of s.settlements) {
    const loc = st as { locationType?: string; mobility?: string };
    if (loc.locationType === undefined) loc.locationType = 'settlement';
    if (loc.mobility === undefined) loc.mobility = 'fixed';
  }

  // Rebuild the unified location registry: settlements join BY REFERENCE (same objects as
  // world.settlements) alongside any stored generic locations. nextLocationId defaults to
  // the settlement count for pre-v9 saves (which had no generic locations).
  const genericLocations = s.locations ?? [];
  const locations = new Map<LocationId, Location>();
  for (const st of s.settlements) locations.set(st.id, st as Location);
  for (const loc of genericLocations) locations.set(loc.id, loc);
  const nextLocationId = s.nextLocationId ?? s.settlements.length;
  // derive childrenByParent in ascending id order so each child-list is naturally sorted.
  const childrenByParent = new Map<LocationId, LocationId[]>();
  for (const id of [...locations.keys()].sort((a, b) => a - b)) {
    const pid = locations.get(id)!.parentId;
    if (pid === undefined) continue;
    const list = childrenByParent.get(pid);
    if (list) list.push(id);
    else childrenByParent.set(pid, [id]);
  }

  // v10 → v11 (organizations exist): reconstruct a Polity for every governed settlement so
  // a loaded older world also has first-class orgs. New org ids come from above the save's
  // entity high-water mark, so they never collide with existing entities.
  let nextEntityId = s.nextEntityId;
  let organizations: Organization[];
  if (s.organizations) {
    organizations = s.organizations;
  } else {
    organizations = [];
    for (const st of s.settlements) {
      const label = POLITY_LABELS[st.governmentId];
      if (!label) continue; // leaderless (freefolk) settlements host no polity
      const org: Organization = {
        id: nextEntityId++,
        name: `${label} of ${st.name}`,
        category: ORG_CATEGORY_POLITICAL,
        subtype: label.toLowerCase(),
        foundedYear: st.foundedYear,
        governanceId: st.governmentId,
        leaderId: st.currentRulerId,
        seatId: st.id,
        seatHistory: [st.id],
        ...(st.ruinedYear !== undefined ? { dissolvedYear: st.ruinedYear } : {}),
      };
      organizations.push(org);
      (st as { polityId?: OrgId }).polityId = org.id;
    }
  }
  // v14 → v15 (organizations OWN & RELATE): treasuries default to 0 for orgs an older save
  // never funded, and every org gets an adjacency map in the relationship graph (its stored
  // edges, if any, were already rebuilt above via relAdj — this only fills in the missing).
  const orgTreasury = new Map<OrgId, number>(s.orgTreasury ?? []);
  for (const org of organizations) {
    if (!orgTreasury.has(org.id)) orgTreasury.set(org.id, 0);
    if (!rels.has(org.id)) rels.set(org.id, new Map());
  }
  const organizationsById = new Map<OrgId, Organization>(organizations.map((o) => [o.id, o]));

  // v11 → v12 (institutional memory): if no roster was stored, reconstruct a current 'leader'
  // record for each org that has a leader, dated to its founding (the historical line of
  // prior leaders is not recoverable from an older save, only the sitting one).
  const orgMembers = new Map<OrgId, OrgMember[]>();
  if (s.orgMembers) {
    for (const [id, list] of s.orgMembers) orgMembers.set(id, list);
  } else {
    for (const org of organizations) {
      if (org.leaderId === undefined) continue;
      orgMembers.set(org.id, [{ actorId: org.leaderId, role: 'leader', sinceTick: org.foundedYear * DAYS_PER_YEAR }]);
    }
  }

  // v13 → v14 (execution): operational state defaults to the pack baseline per org; the
  // last-action log is empty (no actions had been executed under an older engine).
  const operationalState = new Map<OrgId, OperationalState>();
  if (s.operationalState) {
    for (const [id, st] of s.operationalState) operationalState.set(id, st);
  } else {
    for (const org of organizations) operationalState.set(org.id, baselineOperational());
  }
  const lastAction = new Map<OrgId, OrgAction>(s.lastAction ?? []);

  return {
    seed: s.seed,
    substrate: createSubstrate(s.seed), // not serialized — regenerated identically from seed
    tick: s.tick,
    rng,
    settlements: s.settlements,
    locations,
    nextLocationId,
    childrenByParent,
    // pre-v10 saves had no transit stream; reseed deterministically from the world seed.
    travelRngState: s.travelRngState ?? mixSeed(s.seed, 0x713a),
    edges: s.edges,
    geoRngState: s.geoRngState,
    focusedSettlementId: s.focusedSettlementId,
    homeSettlement: new Map(s.homeSettlement),
    fidelity: new Map(s.fidelity),
    nextEntityId,
    nextEventId: s.nextEventId,
    entities,
    deadEntities,
    stats,
    identity: new Map(s.identity),
    names: new Map(s.names),
    lifecycle: new Map(s.lifecycle),
    needs: new Map(s.needs),
    // pre-v21 saves carry no mood memory: every living actor starts unburdened, but the
    // MAP ENTRY must exist for full actors (it is the addSelfThought LOD gate).
    selfThoughts: new Map(s.selfThoughts ?? s.needs.map(([id]) => [id, []] as [number, Thought[]])),
    traits: new Map(s.traits),
    personality: new Map(s.personality ?? []), // innate value profiles, fixed at birth
    profession: new Map(s.profession),
    ties: new Map(s.ties),
    memory: new Map(s.memory),
    reputation: new Map(s.reputation ?? []), // public standing as witnessed-deed marks
    beliefs: new Map(s.beliefs ?? []),       // subjective beliefs — empty on pre-1A saves
    reactions: new Set(s.reactions ?? []),   // fired belief-reactions — empty on pre-1B saves
    newsFront: new Map(s.newsFront ?? []),   // objective news frontier — empty on pre-1C-distal saves
    faith: new Map(s.faith ?? []),           // religious affiliation, stable from birth
    exiles: new Map(s.exiles ?? []),         // exile records — empty on pre-Stage-2 saves
    rels,
    firstEventId: (s as { firstEventId?: number }).firstEventId ?? 1,
    eventArchive: new Map((s as { eventArchive?: [number, World['events'][number]][] }).eventArchive ?? []),
    events: s.events,
    // derived indexes — rebuilt from the full event set (recent buffer + archive).
    eventsBySubject: (() => {
      const archiveEvents = ((s as { eventArchive?: [number, World['events'][number]][] }).eventArchive ?? []).map(([, ev]) => ev);
      const m = new Map<number, number[]>();
      for (const ev of [...archiveEvents, ...s.events])
        for (const subj of ev.subjects) {
          const list = m.get(subj);
          if (list) list.push(ev.id);
          else m.set(subj, [ev.id]);
        }
      return m;
    })(),
    eventsBySettlement: (() => {
      // Reconstruct by matching event data string values against the settlement name map.
      const archiveEvents = ((s as { eventArchive?: [number, World['events'][number]][] }).eventArchive ?? []).map(([, ev]) => ev);
      const nameToId = new Map<string, number>();
      for (const st of s.settlements) nameToId.set(st.name, st.id);
      const m = new Map<number, number[]>();
      for (const ev of [...archiveEvents, ...s.events]) {
        for (const val of Object.values(ev.data)) {
          if (typeof val !== 'string') continue;
          const sid = nameToId.get(val);
          if (sid === undefined) continue;
          const list = m.get(sid);
          if (list) list.push(ev.id);
          else m.set(sid, [ev.id]);
        }
      }
      return m;
    })(),
    figures: s.figures,
    figuresById: new Map(s.figures.map((f) => [f.id, f])),
    figuresBySettlement: (() => {
      const m = new Map<number, number[]>();
      for (const f of s.figures) {
        const list = m.get(f.settlementId);
        if (list) list.push(f.id);
        else m.set(f.settlementId, [f.id]);
      }
      return m;
    })(),
    houses: s.houses ?? [],
    organizations,
    organizationsById,
    orgMembers,
    // pre-v13 saves carry no reasoning record; it is recomputed on the next yearly tick.
    currentIntent: new Map(s.currentIntent ?? []),
    operationalState,
    lastAction,
    orgTreasury,
    // v15 → v16 (interaction): no agreements or negotiation memory under an older engine.
    orgAgreements: s.orgAgreements ?? [],
    lastInteraction: new Map(s.lastInteraction ?? []),
    chronicle: s.chronicle,
    annals: s.annals,
    chronicleCursor: s.chronicleCursor,
    director: s.director,
    directorRngState: s.directorRngState,
    figureRngState: s.figureRngState,
    playerId: s.playerId ?? undefined,
    playerRngState: s.playerRngState,
    playerGoal: s.playerGoal ?? undefined,
    playerAmbition: s.playerAmbition ?? undefined,
    playerInputs: s.playerInputs,
  };
}
