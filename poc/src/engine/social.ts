/**
 * Generic SOCIAL QUERIES over world state — reusable MECHANISM that the aspiration pack
 * (content/aspirations.ts) and courtship (systems/resolve.ts) build policy on. These are
 * universe-neutral: "the warmest eligible match", "the bitterest active feud", "do I hold
 * the ruler's seat". A pack with no romance simply never calls bestSuitor; a leaderless
 * polity makes canSeekRule false. Kept OUT of aspiration.ts so the pack can import them
 * without a cycle (aspiration.ts imports the pack's ladder).
 */
import { type World, type EntityId } from './model';
import { computeOpinion } from './opinion';
import { isKin, canTakeSpouse } from './world';
import { maturityOf, unionViable, hasLeader } from '../content/fixture';

const CRUSH_WARMTH = 120; // opinion that marks a real fondness (vs an acquaintance)

/** Whether two actors are a plausible marriage match (each adult by THEIR OWN species'
 *  maturity; wider age gaps allowed later in life). Shared by courtship (who you pine
 *  for) and the wedding gate, so actors only pursue partners they could actually marry. */
export function ageCompatible(world: World, a: EntityId, b: EntityId): boolean {
  const ageA = world.lifecycle.get(a)!.ageYears;
  const ageB = world.lifecycle.get(b)!.ageYears;
  const matA = maturityOf(world.identity.get(a)!.speciesId);
  const matB = maturityOf(world.identity.get(b)!.speciesId);
  if (ageA < matA || ageB < matB) return false;
  // slack scales with how far past their OWN maturity the younger partner is.
  const youngerSlack = Math.min(ageA - matA, ageB - matB);
  return Math.abs(ageA - ageB) <= 12 + Math.round(youngerSlack * 0.4);
}

/** The warmest eligible match this actor already knows — their emergent "crush". */
export function bestSuitor(world: World, id: EntityId): EntityId | undefined {
  const me = world.identity.get(id)!;
  if (!canTakeSpouse(world, id)) return undefined;
  let best: EntityId | undefined;
  let bestOpinion = CRUSH_WARMTH;
  for (const [other, edge] of world.rels.get(id)!) {
    const olc = world.lifecycle.get(other);
    if (!olc?.alive) continue;
    const oi = world.identity.get(other);
    if (!oi || !unionViable(me.speciesId, me.sex, oi.speciesId, oi.sex)) continue; // species-defined compatibility
    if (!canTakeSpouse(world, other)) continue;
    if (!ageCompatible(world, id, other)) continue; // only pine for the marriageable
    if (isKin(world, id, other)) continue;
    const op = computeOpinion(edge, world.tick);
    if (op > bestOpinion) {
      bestOpinion = op;
      best = other;
    }
  }
  return best;
}

/** The bitterest active feud, if any. */
export function strongestFeud(world: World, id: EntityId): EntityId | undefined {
  let worst: EntityId | undefined;
  let worstOpinion = 0;
  for (const [other, edge] of world.rels.get(id)!) {
    if (!edge.flags.feud) continue;
    if (!world.lifecycle.get(other)?.alive) continue;
    const op = computeOpinion(edge, world.tick);
    if (op < worstOpinion) {
      worstOpinion = op;
      worst = other;
    }
  }
  return worst;
}

/** Whether this actor currently holds its settlement's ruler seat. */
export function isRuler(world: World, id: EntityId): boolean {
  const h = world.homeSettlement.get(id);
  return h !== undefined && world.settlements[h]?.currentRulerId === id;
}

/** Whether this actor's polity even has a leadership seat to aspire to (not a
 *  leaderless government). */
export function canSeekRule(world: World, id: EntityId): boolean {
  const h = world.homeSettlement.get(id);
  return h !== undefined && hasLeader(world.settlements[h].governmentId);
}
