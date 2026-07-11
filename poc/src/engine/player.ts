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
 * Leaving home (design/26 P5): the player moves their LIFE to another settlement,
 * riding the same bookkeeping migrationYearly applies to any adult who chooses to
 * leave — drop to the summary tier, rehome, move one head between the towns'
 * ledgers — and then attention follows the life, exactly as it follows an heir at
 * inheritance. A RAILS operation (between turns, like possess/inherit), never an
 * act-loop action: a focus shift demotes and promotes whole casts, which cannot
 * happen mid-week while the act loop iterates. Spouse and children stay behind —
 * distance is a story, not an erasure; the ties and rels persist. No-op when
 * nothing sensible can happen (no player, dead, same town, a ruin).
 */
export function leaveFor(world: World, destId: number): void {
  const p = world.playerId;
  if (p === undefined || !isAlive(world, p)) return;
  if (destId < 0 || destId >= world.settlements.length) return;
  const from = world.homeSettlement.get(p);
  if (from === undefined || destId === from) return;
  const dest = world.settlements[destId];
  if (dest.ruinedYear !== undefined) return; // no one settles a ruin

  // Ledger rule (as in migrationYearly): an UNFOCUSED town's macro headcount is
  // maintained by hand; the focused town's is retallied from its full actors at
  // demote time, so it needs no manual entry on either side of the move.
  if (from !== world.focusedSettlementId) {
    const m = world.settlements[from].macro;
    m.population = Math.max(0, m.population - 1);
  }
  world.fidelity.set(p, 'summary');
  world.homeSettlement.set(p, destId);
  emit(world, 'emigrated', [p], { from: world.settlements[from].name, to: dest.name }, [], [from, destId]);

  if (destId !== world.focusedSettlementId) {
    dest.macro.population += 1; // one more head for promote to materialize
    // attention follows the life: promoting the destination raises the player —
    // now one of its summary residents — back to full fidelity.
    focusSettlement(world, destId);
  } else {
    // moving INTO the already-watched town: immigrant mechanics, no focus shift
    world.fidelity.set(p, 'full');
  }
}

/**
 * The player's intent for the current tick, or `idle` if none is scheduled. Pure
 * read (no mutation), so replay from the same log is deterministic. Scans from the
 * end so the most recently scheduled intent for a tick wins; O(n) is fine for the
 * PoC (a production engine would index by tick).
 */
/** The player's scheduled intent for THIS tick, or undefined when the week is
 *  undirected — in which case the act loop lets the character live by the same
 *  decider as every other soul (the AUTOPILOT, design/26 P1). The player
 *  intervenes; the character lives. */
export function takePlayerIntent(world: World): Intent | undefined {
  for (let i = world.playerInputs.length - 1; i >= 0; i--) {
    if (world.playerInputs[i].tick === world.tick) return world.playerInputs[i].intent;
  }
  return undefined;
}
