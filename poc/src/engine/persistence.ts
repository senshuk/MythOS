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
import { type World, type Identity, type Lifecycle, type Needs, type SocialTies, type RelEdge, type Reputation } from './model';
import { type Intent } from './intent';
import { Rng } from './rng';
import { createSubstrate } from './substrate';

export const SAVE_VERSION = 7;

/** A fully serialized world — plain data only (JSON-safe & structured-clonable). */
export interface SaveFile {
  version: number;

  // scalars + RNG cursors
  seed: number;
  tick: number;
  rngState: number;
  geoRngState: number;
  focusedSettlementId: number;
  nextEntityId: number;
  nextEventId: number;
  chronicleCursor: number;
  directorRngState: number;
  figureRngState: number;
  playerRngState: number;
  playerId: number | null;
  playerGoal: { kind: string; target?: number } | null;

  // plain arrays / objects (already JSON-safe)
  settlements: World['settlements'];
  edges: World['edges'];
  entities: number[];
  deadEntities: number[];
  stats: { born: number; died: number; marriages: number; feuds: number };
  events: World['events'];
  chronicle: World['chronicle'];
  annals: World['annals'];
  director: World['director'];
  figures: World['figures'];
  houses: World['houses'];
  playerInputs: { tick: number; intent: Intent }[];

  // component maps, as entries
  homeSettlement: [number, number][];
  fidelity: [number, World['fidelity'] extends Map<number, infer V> ? V : never][];
  identity: [number, Identity][];
  names: [number, string][];
  lifecycle: [number, Lifecycle][];
  needs: [number, Needs][];
  traits: [number, string[]][];
  personality: [number, { values: Record<string, number>; temperament: Record<string, number> }][];
  profession: [number, string][];
  ties: [number, SocialTies][];
  memory: [number, number[]][];
  reputation: [number, Reputation][];

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
    focusedSettlementId: world.focusedSettlementId,
    nextEntityId: world.nextEntityId,
    nextEventId: world.nextEventId,
    chronicleCursor: world.chronicleCursor,
    directorRngState: world.directorRngState,
    figureRngState: world.figureRngState,
    playerRngState: world.playerRngState,
    playerId: world.playerId ?? null,
    playerGoal: world.playerGoal ?? null,

    settlements: world.settlements,
    edges: world.edges,
    entities: world.entities,
    deadEntities: world.deadEntities,
    stats: world.stats,
    events: world.events,
    chronicle: world.chronicle,
    annals: world.annals,
    director: world.director,
    figures: world.figures,
    houses: world.houses,
    playerInputs: world.playerInputs,

    homeSettlement: [...world.homeSettlement],
    fidelity: [...world.fidelity],
    identity: [...world.identity],
    names: [...world.names],
    lifecycle: [...world.lifecycle],
    needs: [...world.needs],
    traits: [...world.traits],
    personality: [...world.personality],
    profession: [...world.profession],
    ties: [...world.ties],
    memory: [...world.memory],
    reputation: [...world.reputation],

    relPool,
    relAdj,
  };
}

/** Rebuild a live World from a SaveFile. Throws on an unsupported version. */
export function deserializeWorld(s: SaveFile): World {
  if (s.version !== SAVE_VERSION && s.version !== 5 && s.version !== 6) {
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

  return {
    seed: s.seed,
    substrate: createSubstrate(s.seed), // not serialized — regenerated identically from seed
    tick: s.tick,
    rng,
    settlements: s.settlements,
    edges: s.edges,
    geoRngState: s.geoRngState,
    focusedSettlementId: s.focusedSettlementId,
    homeSettlement: new Map(s.homeSettlement),
    fidelity: new Map(s.fidelity),
    nextEntityId: s.nextEntityId,
    nextEventId: s.nextEventId,
    entities,
    deadEntities,
    stats,
    identity: new Map(s.identity),
    names: new Map(s.names),
    lifecycle: new Map(s.lifecycle),
    needs: new Map(s.needs),
    traits: new Map(s.traits),
    personality: new Map(s.personality ?? []), // innate value profiles, fixed at birth
    profession: new Map(s.profession),
    ties: new Map(s.ties),
    memory: new Map(s.memory),
    reputation: new Map(s.reputation ?? []), // public standing as witnessed-deed marks
    rels,
    events: s.events,
    // derived index — rebuilt from events rather than serialized (no SAVE_VERSION bump needed).
    eventsBySubject: (() => {
      const m = new Map<number, number[]>();
      for (const ev of s.events)
        for (const subj of ev.subjects) {
          const list = m.get(subj);
          if (list) list.push(ev.id);
          else m.set(subj, [ev.id]);
        }
      return m;
    })(),
    chronicle: s.chronicle,
    annals: s.annals,
    chronicleCursor: s.chronicleCursor,
    director: s.director,
    directorRngState: s.directorRngState,
    figures: s.figures,
    houses: s.houses ?? [],
    figureRngState: s.figureRngState,
    playerId: s.playerId ?? undefined,
    playerRngState: s.playerRngState,
    playerGoal: s.playerGoal ?? undefined,
    playerInputs: s.playerInputs,
  };
}
