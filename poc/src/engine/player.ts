/**
 * Player control rails. Possession is just "set world.playerId" — there is no
 * player-specific simulation code; the act loop (systems/social.ts) simply reads
 * the player's intent from the input log instead of running the NPC decider, and
 * the resolver (systems/resolve.ts) runs the player's chosen action against the
 * dedicated player RNG stream. Everything else is identical to an NPC.
 *
 * Intents are scheduled into `world.playerInputs` keyed by the tick they apply on.
 * That log IS the player's contribution to world state — replaying it reproduces
 * the world exactly. (The live worker control loop that stamps a buffered UI
 * intent with the correct tick is a separate, later step; these primitives are
 * what it will build on, and what the determinism tests drive directly.)
 */
import { type World, type EntityId, type EventId } from './model';
import { type Intent } from './intent';
import { emit, getEvent, fullName, isAlive } from './world';
import { focusSettlement } from './lod';

/** Take control of an actor. The actor keeps obeying every normal rule. A new life carries no
 *  inherited ambition — the committed goal (if any) belonged to the previous actor. */
export function possess(world: World, actorId: EntityId): void {
  world.playerId = actorId;
  world.playerAmbition = undefined;
}

/** Relinquish control; the actor reverts to NPC decision-making. */
export function release(world: World): void {
  world.playerId = undefined;
  world.playerAmbition = undefined;
}

/** Schedule the player's intent for a given tick (appends to the replay log). */
export function schedulePlayerIntent(world: World, tick: number, intent: Intent): void {
  world.playerInputs.push({ tick, intent });
}

// ------------------------------------------------ dynasty: death as a transition

/** How the heir stands to the one who died — resolved to a pack phrase by the view. */
export type HeirRelation = 'child' | 'spouse' | 'sibling';

/** The most recent death event recorded for an actor, if history still holds it. */
export function deathEventOf(world: World, id: EntityId): EventId | undefined {
  const ids = world.eventsBySubject.get(id) ?? [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const ev = getEvent(world, ids[i]);
    if (ev && (ev.type === 'died' || ev.type === 'died_brawl') && ev.subjects[0] === id) return ev.id;
  }
  return undefined;
}

/** The widow(er)s of a death, recovered from history. killActor severs spouse ties AT
 *  death (the widowed are no longer "wed to the dead"), so the living partner is found
 *  through the `widowed` events it emitted — each cites the death as its cause and
 *  immediately follows it in the log. Empty once those events age out of the window. */
function widowsOf(world: World, deathId: EventId): EntityId[] {
  const out: EntityId[] = [];
  for (let eid = deathId + 1; ; eid++) {
    const ev = getEvent(world, eid);
    if (!ev || ev.type !== 'widowed' || !ev.causes.includes(deathId)) break;
    out.push(ev.subjects[0]);
  }
  return out;
}

/**
 * The heir to a dead actor's line: their eldest living child, else their surviving
 * spouse, else their eldest living sibling. Blood first, then the household, then the
 * wider line — a *family* rule (one line continuing), distinct from the seat-succession
 * rules that pass a THRONE (figures.ts / pack succession data). Deterministic: age
 * decides within a tier, lowest id breaks age ties. Undefined = the line has ended.
 */
export function heirOf(world: World, id: EntityId): { heirId: EntityId; relation: HeirRelation } | undefined {
  const ageOf = (a: EntityId) => world.lifecycle.get(a)!.ageYears;
  const living = (a: EntityId) => a !== id && world.identity.has(a) && isAlive(world, a);
  const eldest = (ids: EntityId[]): EntityId | undefined =>
    ids.filter(living).sort((a, b) => ageOf(b) - ageOf(a) || a - b)[0];

  const ties = world.ties.get(id);
  if (!ties) return undefined;

  const child = eldest(ties.children);
  if (child !== undefined) return { heirId: child, relation: 'child' };

  const deathId = deathEventOf(world, id);
  const widow = deathId !== undefined ? widowsOf(world, deathId).filter(living)[0] : undefined;
  if (widow !== undefined) return { heirId: widow, relation: 'spouse' };

  const siblings = ties.parents.flatMap((p) => world.ties.get(p)?.children ?? []);
  const sibling = eldest([...new Set(siblings)]);
  if (sibling !== undefined) return { heirId: sibling, relation: 'sibling' };

  return undefined;
}

/**
 * Death as a TRANSITION (the Dynasty step of the gameplay loop): pass control of a dead
 * player's story to their heir. Follows the line wherever it lives — if the heir is a
 * named soul in another settlement, attention (focus) moves there first, which promotes
 * them to full fidelity through the normal LOD machinery. The handoff is recorded as an
 * `inherited` event caused by the death, so the chronicle can trace the line's turning.
 * A no-op while the player lives, when no one is possessed, or when no kin remains
 * (the line has ended — release, or follow another life).
 */
export function inheritHeir(world: World): void {
  const dead = world.playerId;
  if (dead === undefined) return;
  if (world.lifecycle.get(dead)?.alive !== false) return; // only the dead are succeeded
  const heir = heirOf(world, dead);
  if (!heir) return;

  const deathId = deathEventOf(world, dead);
  const predecessorName = fullName(world, dead);

  // follow the line to where it lives (promotes a summary heir to full fidelity)
  const heirHome = world.homeSettlement.get(heir.heirId);
  if (heirHome !== undefined && heirHome !== world.focusedSettlementId) {
    focusSettlement(world, heirHome);
  }

  possess(world, heir.heirId); // a new life: fresh ambitions, same world
  const house = world.identity.get(heir.heirId)?.family;
  emit(
    world,
    'inherited',
    [heir.heirId],
    { predecessor: predecessorName, relation: heir.relation, ...(house ? { house } : {}) },
    deathId !== undefined ? [deathId] : [],
    heirHome !== undefined ? [heirHome] : [],
  );
}

/**
 * The player's intent for the current tick, or `idle` if none is scheduled. Pure
 * read (no mutation), so replay from the same log is deterministic. Scans from the
 * end so the most recently scheduled intent for a tick wins; O(n) is fine for the
 * PoC (a production engine would index by tick).
 */
export function takePlayerIntent(world: World): Intent {
  for (let i = world.playerInputs.length - 1; i >= 0; i--) {
    if (world.playerInputs[i].tick === world.tick) return world.playerInputs[i].intent;
  }
  return { kind: 'idle' };
}
