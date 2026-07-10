/**
 * THE NEWS FRONTIER (Subjectivity 1C-distal; design/20).
 *
 * Objective transport state — NOT belief, NOT epistemics. When an event of world-interest
 * happens at a place, word of it propagates outward across the map at travel speed; this records,
 * per (observer settlement, subject), the tick at which that word ARRIVES there. It is logistics,
 * the same tier as travel and geography: it exists whether or not anyone is currently simulated to
 * believe it. Minds convert news into Evidence elsewhere (that is the frozen epistemic pipeline).
 *
 * ONLY TRANSPORT ADVANCES THE FRONTIER. `propagateCoronation` is its sole writer today; no reducer,
 * consumer, reaction, or focus change may ever touch `world.newsFront` directly — the same class of
 * prohibition as "only witnesses create Evidence". Deterministic: arrival = event tick +
 * ceil(distance / TRAVEL_SPEED); no RNG. News is the first payload; the frontier is the system.
 */
import { type World, type EntityId } from './model';
import { TRAVEL_SPEED } from './pack';

/** Key: what `observer` settlement knows of the ruler of `subject` settlement. */
export function newsKey(observerSettlementId: number, subjectSettlementId: number): string {
  return `${observerSettlementId}:ruler:${subjectSettlementId}`;
}

/** Ticks for word to travel from one settlement to another — the wavefront's speed across the map. */
function latency(world: World, fromId: number, toId: number): number {
  if (fromId === toId) return 0; // it happened here; no delay
  const a = world.settlements[fromId];
  const b = world.settlements[toId];
  if (!a || !b) return 0;
  return Math.ceil(world.substrate.distance(a.pos, b.pos) / TRAVEL_SPEED);
}

/**
 * A coronation at `subjectSettlementId` (its new ruler is `rulerId`). The frontier of that news
 * expands to every settlement: the origin knows at once, distant places later, by travel time.
 * Overwrites any prior coronation news for that subject (only the latest ruler matters). THE ONE
 * WRITER of the frontier. Objective — writes only `world.newsFront`, forms no belief, emits nothing.
 */
export function propagateCoronation(world: World, subjectSettlementId: number, rulerId: EntityId): void {
  for (const observer of world.settlements) {
    if (observer.ruinedYear !== undefined) continue;
    const arrival = world.tick + latency(world, subjectSettlementId, observer.id);
    world.newsFront.set(newsKey(observer.id, subjectSettlementId), { ruler: rulerId, arrival });
  }
}
