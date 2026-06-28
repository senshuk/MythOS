/**
 * The Spatial Foundation: the engine's generic Location model and its containment tree.
 *
 * A Location is a spatial container (constitution: `design/11-simulation-ontology.md`,
 * `design/14-component-model.md`). Locations nest into an acyclic tree via `parentId`
 * (a city inside a kingdom inside a continent inside a planet). This module is the
 * SINGLE home for that tree: every mutation (create, reparent, remove) goes through
 * here so the acyclic invariant and the `childrenByParent` index stay consistent, and
 * every reader (today and in future phases — trade, AI, travel, diplomacy) uses the
 * query API below instead of walking `parentId` by hand.
 *
 * Determinism: all traversals return children in ascending id order, so descendant
 * walks and common-ancestor results are stable across runs and across a save/load.
 *
 * Scope note (Phase 1A): `mobility` is recorded but no movement happens here, and
 * `pos` is treated as immutable. Transit/travel is a later phase.
 */
import {
  type World,
  type Location,
  type LocationId,
  type LocationType,
  type Mobility,
  type WorldPosition,
} from './model';

// ---- index maintenance (internal) ------------------------------------------

/** Insert `childId` into its parent's child-list, keeping the list ascending by id. */
function indexChild(world: World, parentId: LocationId, childId: LocationId): void {
  const list = world.childrenByParent.get(parentId);
  if (!list) {
    world.childrenByParent.set(parentId, [childId]);
    return;
  }
  // ordered insert (lists are tiny; a linear scan is fine and keeps order deterministic)
  let i = 0;
  while (i < list.length && list[i] < childId) i++;
  if (list[i] !== childId) list.splice(i, 0, childId);
}

/** Remove `childId` from its parent's child-list, dropping the entry when it empties. */
function unindexChild(world: World, parentId: LocationId, childId: LocationId): void {
  const list = world.childrenByParent.get(parentId);
  if (!list) return;
  const i = list.indexOf(childId);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) world.childrenByParent.delete(parentId);
}

/**
 * Register an EXISTING Location object into the registry and the child index. Used by
 * worldgen (settlements) and by save-load to (re)build `world.locations` /
 * `childrenByParent` from already-constructed location objects. Does not allocate an id.
 */
export function registerLocation(world: World, loc: Location): void {
  world.locations.set(loc.id, loc);
  if (loc.parentId !== undefined) indexChild(world, loc.parentId, loc.id);
}

/** Rebuild `world.childrenByParent` from `world.locations` (used after a load). */
export function rebuildLocationIndex(world: World): void {
  world.childrenByParent = new Map();
  // iterate in id order so each child-list is naturally ascending
  for (const id of [...world.locations.keys()].sort((a, b) => a - b)) {
    const loc = world.locations.get(id)!;
    if (loc.parentId !== undefined) indexChild(world, loc.parentId, id);
  }
}

// ---- creation --------------------------------------------------------------

export interface LocationProps {
  name: string;
  locationType: LocationType;
  mobility?: Mobility; // default 'fixed'
  parentId?: LocationId;
  pos?: WorldPosition;
  nameMeaning?: string;
  foundedYear?: number;
}

/**
 * Create a generic (non-settlement) Location, allocating a fresh id from
 * `world.nextLocationId`. Throws if `parentId` names a location that does not exist or
 * would (trivially) be a cycle. Settlements are NOT created here — they are minted by
 * the LOD layer and registered via `registerLocation`.
 */
export function createLocation(world: World, p: LocationProps): LocationId {
  if (p.parentId !== undefined && !world.locations.has(p.parentId)) {
    throw new Error(`createLocation: parent ${p.parentId} does not exist`);
  }
  const id = world.nextLocationId++;
  const loc: Location = {
    id,
    name: p.name,
    nameMeaning: p.nameMeaning,
    locationType: p.locationType,
    mobility: p.mobility ?? 'fixed',
    parentId: p.parentId,
    pos: p.pos,
    foundedYear: p.foundedYear ?? Math.floor(world.tick / 365),
  };
  registerLocation(world, loc);
  return id;
}

// ---- the containment tree --------------------------------------------------

/** A Location by id (settlement or generic), or undefined if unknown. */
export function getLocation(world: World, id: LocationId): Location | undefined {
  return world.locations.get(id);
}

/** The immediate container of `id`, or undefined if it is a root / unknown. */
export function getParent(world: World, id: LocationId): Location | undefined {
  const pid = world.locations.get(id)?.parentId;
  return pid === undefined ? undefined : world.locations.get(pid);
}

/** The immediate children of `id`, in ascending id order (deterministic). */
export function getChildren(world: World, id: LocationId): Location[] {
  const ids = world.childrenByParent.get(id);
  if (!ids) return [];
  const out: Location[] = [];
  for (const cid of ids) {
    const c = world.locations.get(cid);
    if (c) out.push(c);
  }
  return out;
}

/** Ancestors of `id` from nearest parent up to the root (root last). Excludes `id`. */
export function getAncestors(world: World, id: LocationId): Location[] {
  const out: Location[] = [];
  const seen = new Set<LocationId>([id]); // guard against a malformed (cyclic) store
  let pid = world.locations.get(id)?.parentId;
  while (pid !== undefined && !seen.has(pid)) {
    const p = world.locations.get(pid);
    if (!p) break;
    out.push(p);
    seen.add(pid);
    pid = p.parentId;
  }
  return out;
}

/**
 * All descendants of `id` (the whole subtree below it), excluding `id`, in a
 * deterministic pre-order DFS that visits children in ascending id order.
 */
export function getDescendants(world: World, id: LocationId): Location[] {
  const out: Location[] = [];
  const visit = (nid: LocationId): void => {
    for (const child of getChildren(world, nid)) {
      out.push(child);
      visit(child.id);
    }
  };
  visit(id);
  return out;
}

/** The root of `id`'s tree (the topmost ancestor, or `id` itself if it is a root). */
export function getRoot(world: World, id: LocationId): Location | undefined {
  const self = world.locations.get(id);
  if (!self) return undefined;
  const anc = getAncestors(world, id);
  return anc.length > 0 ? anc[anc.length - 1] : self;
}

/** Is `a` an ancestor of `b`? (Strict — a location is not its own ancestor.) */
export function isAncestor(world: World, a: LocationId, b: LocationId): boolean {
  return getAncestors(world, b).some((loc) => loc.id === a);
}

/** Is `a` a descendant of `b`? (Strict.) */
export function isDescendant(world: World, a: LocationId, b: LocationId): boolean {
  return isAncestor(world, b, a);
}

/**
 * The nearest common ancestor of `a` and `b` (the deepest location that contains both),
 * or undefined if they are in different trees. If one is an ancestor of the other, that
 * ancestor is returned.
 */
export function commonAncestor(world: World, a: LocationId, b: LocationId): Location | undefined {
  // chain-of-self-and-ancestors for each, nearest-first
  const chainA: LocationId[] = world.locations.has(a) ? [a, ...getAncestors(world, a).map((l) => l.id)] : [];
  const ancestorsOfA = new Set(chainA);
  const chainB: LocationId[] = world.locations.has(b) ? [b, ...getAncestors(world, b).map((l) => l.id)] : [];
  for (const id of chainB) {
    if (ancestorsOfA.has(id)) return world.locations.get(id);
  }
  return undefined;
}

// ---- mutation --------------------------------------------------------------

/**
 * Re-parent `id` under `parentId` (or detach to a root with `undefined`). The ONLY way
 * to change the tree's shape. Rejects any move that would create a cycle (you cannot put
 * a location inside one of its own descendants, nor inside itself) and any unknown id.
 * Keeps `childrenByParent` consistent. Moving a node moves its whole subtree with it.
 */
export function setParent(world: World, id: LocationId, parentId?: LocationId): void {
  const loc = world.locations.get(id);
  if (!loc) throw new Error(`setParent: location ${id} does not exist`);
  if (parentId !== undefined) {
    if (!world.locations.has(parentId)) throw new Error(`setParent: parent ${parentId} does not exist`);
    if (parentId === id) throw new Error(`setParent: a location cannot be its own parent (${id})`);
    // a cycle would form iff the proposed parent is the node itself or one of its descendants.
    if (isDescendant(world, parentId, id)) {
      throw new Error(`setParent: cannot move ${id} under its own descendant ${parentId} (cycle)`);
    }
  }
  if (loc.parentId === parentId) return; // no-op
  if (loc.parentId !== undefined) unindexChild(world, loc.parentId, id);
  loc.parentId = parentId;
  if (parentId !== undefined) indexChild(world, parentId, id);
}

export type RemovePolicy = 'reparent' | 'cascade';

/**
 * Remove a location from the tree.
 *  - 'reparent' (default): its children adopt its parent (its grandparent for them), so
 *    the rest of the tree stays connected. The node is removed from the registry.
 *  - 'cascade': the node AND its entire subtree are removed.
 *
 * Returns the ids that were removed. NB: this removes locations from the spatial
 * registry; it does not free a Settlement's simulation components (settlements use the
 * existing ruin/demote paths — this API is for generic locations).
 */
export function removeLocation(world: World, id: LocationId, policy: RemovePolicy = 'reparent'): LocationId[] {
  const loc = world.locations.get(id);
  if (!loc) return [];
  const removed: LocationId[] = [];

  if (policy === 'cascade') {
    // remove deepest-first so each unindex sees a still-consistent tree
    const subtree = getDescendants(world, id).map((l) => l.id);
    for (const cid of [...subtree].reverse()) detach(world, cid, removed);
    detach(world, id, removed);
    return removed;
  }

  // reparent: hand each direct child up to this node's parent, then drop this node.
  for (const child of getChildren(world, id)) setParent(world, child.id, loc.parentId);
  detach(world, id, removed);
  return removed;
}

/** Unlink a single (childless-or-ignored) node from index + registry. Internal. */
function detach(world: World, id: LocationId, removed: LocationId[]): void {
  const loc = world.locations.get(id);
  if (!loc) return;
  if (loc.parentId !== undefined) unindexChild(world, loc.parentId, id);
  world.childrenByParent.delete(id); // drop its own (now-orphaned) child-list entry
  world.locations.delete(id);
  removed.push(id);
}
