/**
 * Low-level world operations: id allocation, entity creation, relationship edges,
 * event emission, memory. Pure data mutation — no decision logic (that lives in
 * systems/). The only content it reads is the pack's NEEDS vector, to initialize an
 * actor's needs (the pack doesn't import world, so there's no cycle).
 */
import {
  type World,
  type EntityId,
  type EventId,
  type EventType,
  type RelEdge,
  type Sex,
  type Needs,
  DAYS_PER_YEAR,
  MEMORY_LIMIT,
} from './model';
import { NEEDS, monogamousOf, valueProfile, temperamentProfile } from '../content/fixture';
import { Rng, mixSeed } from './rng';

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
  for (const k of NEEDS) n[k] = 500;
  return n;
}

/** Is this actor currently wed (to anyone)? */
export function isWed(world: World, id: EntityId): boolean {
  return (world.ties.get(id)?.spouses.length ?? 0) > 0;
}

/** This actor's primary (first) spouse, if any — the partner used where one is needed
 *  (display, the co-parent of a birth). For a monogamous species this is their spouse. */
export function primarySpouse(world: World, id: EntityId): EntityId | undefined {
  return world.ties.get(id)?.spouses[0];
}

/** May this actor take a(nother) spouse? A monogamous species can only wed when unwed;
 *  a non-monogamous one always may. This replaces the old "spouse === undefined" gate so
 *  monogamy is SPECIES DATA, not a hardcoded assumption. */
export function canTakeSpouse(world: World, id: EntityId): boolean {
  const t = world.ties.get(id);
  if (!t) return false;
  const sp = world.identity.get(id)?.speciesId;
  if (sp && !monogamousOf(sp)) return true;
  return t.spouses.length === 0;
}

/** Remove `other` from `id`'s spouse list (one direction). */
export function removeSpouse(world: World, id: EntityId, other: EntityId): void {
  const t = world.ties.get(id);
  if (!t) return;
  const i = t.spouses.indexOf(other);
  if (i >= 0) t.spouses.splice(i, 1);
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
  world.ties.set(id, { spouses: [], parents: p.parents ? [...p.parents] : [], children: [] });
  world.memory.set(id, []);
  world.reputation.set(id, { marks: [] });
  world.rels.set(id, new Map());
  // new actors are born/created at full fidelity in the focused settlement
  world.fidelity.set(id, 'full');
  world.homeSettlement.set(id, world.focusedSettlementId);
  // INNATE personality, fixed at birth: cultural VALUES (from the culture they are born
  // into + their traits) and individual TEMPERAMENT (traits + a wide deviation, no culture).
  // Both seeded from their id and stored (not re-derived from a mutable home) so they are
  // stable for life, observation-independent, and reload-safe.
  const cultureId = world.settlements[world.focusedSettlementId]?.cultureId ?? '';
  world.personality.set(id, {
    values: valueProfile(cultureId, p.traits, new Rng(mixSeed(world.seed, id, 0x9e1d))),
    temperament: temperamentProfile(p.traits, new Rng(mixSeed(world.seed, id, 0x7c0d))),
  });
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

  // widow every surviving spouse (≤1 for a monogamous species)
  for (const spouse of [...world.ties.get(id)!.spouses]) {
    if (!world.lifecycle.get(spouse)!.alive) continue;
    removeSpouse(world, spouse, id);
    removeSpouse(world, id, spouse);
    const e = world.rels.get(id)!.get(spouse);
    if (e) e.flags.spouse = false;
    emit(world, 'widowed', [spouse], {}, [world.events[world.events.length - 1].id]);
  }

  // sever relationships from the LIVING graph: the dead no longer count as anyone's
  // tie (so relationshipCount, standing, heirship reflect the living). Their bonds
  // live on in the event log, not as a stale +650 to a departed spouse.
  const myRels = world.rels.get(id);
  if (myRels) {
    for (const partner of myRels.keys()) world.rels.get(partner)?.delete(id);
    myRels.clear();
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
  // never free the player's actor — it must survive focus shifts & travel, so the
  // player keeps their identity and history no matter which settlement is focused.
  if (id === world.playerId) return;

  // widow surviving spouses so no dangling spouse reference remains
  const ties = world.ties.get(id);
  if (ties) for (const spouse of ties.spouses) removeSpouse(world, spouse, id);
  // prune reverse edges so surviving (e.g. summary) actors don't dangle
  const myRels = world.rels.get(id);
  if (myRels) for (const partner of myRels.keys()) world.rels.get(partner)?.delete(id);

  world.identity.delete(id);
  world.lifecycle.delete(id);
  world.needs.delete(id);
  world.traits.delete(id);
  world.personality.delete(id);
  world.profession.delete(id);
  world.ties.delete(id);
  world.memory.delete(id);
  world.reputation.delete(id);
  world.rels.delete(id);
  world.homeSettlement.delete(id);
  world.fidelity.delete(id);
  // NB: world.names is intentionally NOT deleted (history outlives the entity)
  const i = world.entities.indexOf(id);
  if (i >= 0) world.entities.splice(i, 1);
}
