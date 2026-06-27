/**
 * Low-level world operations: id allocation, entity creation, relationship edges,
 * event emission, memory. Pure data mutation — no decision logic (that lives in
 * systems/). Kept free of content imports to avoid cycles.
 */
import {
  type World,
  type EntityId,
  type EventId,
  type EventType,
  type RelEdge,
  type Sex,
  type Needs,
  NEED_KEYS,
  DAYS_PER_YEAR,
  MEMORY_LIMIT,
} from './model';

export interface ActorProps {
  given: string;
  family: string;
  sex: Sex;
  speciesId: string;
  profession: string;
  traits: string[];
  ageYears: number;
  parents?: EntityId[];
}

export function midNeeds(): Needs {
  const n = {} as Needs;
  for (const k of NEED_KEYS) n[k] = 500;
  return n;
}

export function createActor(world: World, p: ActorProps): EntityId {
  const id = world.nextEntityId++;
  world.entities.push(id);
  world.identity.set(id, {
    given: p.given,
    family: p.family,
    sex: p.sex,
    speciesId: p.speciesId,
  });
  world.names.set(id, `${p.given} ${p.family}`); // persists past demotion

  world.lifecycle.set(id, {
    bornTick: world.tick - p.ageYears * DAYS_PER_YEAR,
    ageYears: p.ageYears,
    alive: true,
  });
  world.needs.set(id, midNeeds());
  world.traits.set(id, [...p.traits]);
  world.profession.set(id, p.profession);
  world.ties.set(id, { parents: p.parents ? [...p.parents] : [], children: [] });
  world.memory.set(id, []);
  world.rels.set(id, new Map());
  // new actors are born/created at full fidelity in the focused settlement
  world.fidelity.set(id, 'full');
  world.homeSettlement.set(id, world.focusedSettlementId);
  return id;
}

/** Live full-fidelity actors (the focused settlement), in id order. */
export function fullActors(world: World): EntityId[] {
  const out: EntityId[] = [];
  for (const id of world.entities) {
    if (world.lifecycle.get(id)!.alive && world.fidelity.get(id) === 'full') out.push(id);
  }
  return out;
}

/** Live summary actors (named individuals living elsewhere), in id order. */
export function summaryActors(world: World): EntityId[] {
  const out: EntityId[] = [];
  for (const id of world.entities) {
    if (world.lifecycle.get(id)!.alive && world.fidelity.get(id) === 'summary') out.push(id);
  }
  return out;
}

/** Name of the settlement an actor currently calls home, if known. */
export function homeName(world: World, id: EntityId): string | undefined {
  const sid = world.homeSettlement.get(id);
  return sid === undefined ? undefined : world.settlements[sid]?.name;
}

export function isAlive(world: World, id: EntityId): boolean {
  return world.lifecycle.get(id)?.alive ?? false;
}

export function aliveActors(world: World): EntityId[] {
  const out: EntityId[] = [];
  for (const id of world.entities) {
    if (world.lifecycle.get(id)!.alive) out.push(id);
  }
  return out; // already in id order
}

export function fullName(world: World, id: EntityId): string {
  const i = world.identity.get(id);
  if (i) return `${i.given} ${i.family}`;
  return world.names.get(id) ?? `#${id}`; // freed actor — resolve from registry
}

/** Get (or lazily create) the symmetric relationship edge between a and b. */
export function getRel(world: World, a: EntityId, b: EntityId): RelEdge {
  const am = world.rels.get(a)!;
  let edge = am.get(b);
  if (!edge) {
    edge = { thoughts: [], sinceTick: world.tick, flags: {} };
    am.set(b, edge);
    world.rels.get(b)!.set(a, edge); // same object reference in both directions
  }
  return edge;
}

export function relCount(world: World, id: EntityId): number {
  return world.rels.get(id)!.size;
}

export function isKin(world: World, a: EntityId, b: EntityId): boolean {
  const ta = world.ties.get(a)!;
  const tb = world.ties.get(b)!;
  if (ta.parents.includes(b) || tb.parents.includes(a)) return true;
  for (const p of ta.parents) if (tb.parents.includes(p)) return true; // siblings
  return false;
}

export function remember(world: World, id: EntityId, eventId: EventId): void {
  const m = world.memory.get(id)!;
  m.push(eventId);
  if (m.length > MEMORY_LIMIT) m.shift();
}

export function emit(
  world: World,
  type: EventType,
  subjects: EntityId[],
  data: Record<string, number | string> = {},
  causes: EventId[] = [],
): EventId {
  const id = world.nextEventId++;
  world.events.push({
    id,
    tick: world.tick,
    year: Math.floor(world.tick / DAYS_PER_YEAR),
    type,
    subjects: [...subjects],
    data,
    causes: [...causes],
  });
  for (const s of subjects) {
    if (world.memory.has(s)) remember(world, s, id);
  }
  return id;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Shared kill path: mark an actor dead, emit the death event, and widow a
 * surviving spouse. Pure data mutation + event emission — the caller decides
 * *that* someone dies (lifecycle old-age, a brawl, a plague); this just records
 * it consistently. Lives here (not in a system) so every death path shares it
 * without import cycles.
 */
export function killActor(
  world: World,
  id: EntityId,
  tick: number,
  type: 'died' | 'died_brawl',
  others: EntityId[],
  causes: EventId[],
): void {
  const lc = world.lifecycle.get(id)!;
  if (!lc.alive) return;
  lc.alive = false;
  lc.deathTick = tick;

  const subjects = type === 'died_brawl' ? [id, ...others] : [id];
  emit(world, type, subjects, { age: lc.ageYears }, causes);

  // widow the spouse
  const spouse = world.ties.get(id)!.spouse;
  if (spouse !== undefined && world.lifecycle.get(spouse)!.alive) {
    world.ties.get(spouse)!.spouse = undefined;
    world.ties.get(id)!.spouse = undefined;
    const e = world.rels.get(id)!.get(spouse);
    if (e) e.flags.spouse = false;
    emit(world, 'widowed', [spouse], {}, [world.events[world.events.length - 1].id]);
  }
}

/**
 * Fully remove an actor and all its components from the world. Used by demotion:
 * when a settlement folds back into aggregate, its individual actors are freed so
 * the live entity count stays bounded no matter how large the world grows.
 * (All of a settlement's actors are removed together, so dangling reverse rel
 * edges in same-settlement partners are removed in the same pass.)
 */
export function removeActorCompletely(world: World, id: EntityId): void {
  // widow a surviving spouse so no dangling spouse reference remains
  const ties = world.ties.get(id);
  if (ties?.spouse !== undefined) {
    const sp = world.ties.get(ties.spouse);
    if (sp && sp.spouse === id) sp.spouse = undefined;
  }
  // prune reverse edges so surviving (e.g. summary) actors don't dangle
  const myRels = world.rels.get(id);
  if (myRels) for (const partner of myRels.keys()) world.rels.get(partner)?.delete(id);

  world.identity.delete(id);
  world.lifecycle.delete(id);
  world.needs.delete(id);
  world.traits.delete(id);
  world.profession.delete(id);
  world.ties.delete(id);
  world.memory.delete(id);
  world.rels.delete(id);
  world.homeSettlement.delete(id);
  world.fidelity.delete(id);
  // NB: world.names is intentionally NOT deleted (history outlives the entity)
  const i = world.entities.indexOf(id);
  if (i >= 0) world.entities.splice(i, 1);
}
