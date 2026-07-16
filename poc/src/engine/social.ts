/**
 * Generic SOCIAL QUERIES over world state — reusable MECHANISM that the aspiration pack
 * (content/aspirations.ts) and courtship (systems/resolve.ts) build policy on. These are
 * universe-neutral: "the warmest eligible match", "the bitterest active feud", "do I hold
 * the ruler's seat". A pack with no romance simply never calls bestSuitor; a leaderless
 * polity makes canSeekRule false. Kept OUT of aspiration.ts so the pack can import them
 * without a cycle (aspiration.ts imports the pack's ladder).
 */
import { type World, type EntityId, type RelEdge } from './model';
import { computeOpinion } from './opinion';
import { standingOf } from './reputation';
import { isKin, canTakeSpouse, emit } from './world';
import { pickVenue } from './venues';
import { Rng, mixSeed } from './rng';
import { maturityOf, unionViable, hasLeader, valueProfile, temperamentProfile, REPUTATION_EFFECTS, type Personality } from './pack';

const CRUSH_WARMTH = 120; // opinion that marks a real fondness (vs an acquaintance)

/**
 * An actor's PERSONALITY: the cultural VALUES they were born into (bent by their traits)
 * plus an individual TEMPERAMENT (traits + a wide personal deviation, owing nothing to
 * culture). So every soul is unique — two of one creed still differ in nerve and warmth —
 * and some even oppose their kin. Fixed at birth (createActor) and stored, so it is stable
 * for life and identical after a load. The fallback only covers actors minted before this
 * existed (e.g. an old save).
 */
export function personalityOf(world: World, id: EntityId): Personality {
  const stored = world.personality.get(id);
  if (stored) return stored as Personality;
  const home = world.homeSettlement.get(id);
  const cultureId = home !== undefined ? world.settlements[home]?.cultureId ?? '' : world.settlements[0]?.cultureId ?? '';
  const traits = world.traits.get(id) ?? [];
  const p: Personality = {
    values: valueProfile(cultureId, traits, new Rng(mixSeed(world.seed, id, 0x9e1d))),
    temperament: temperamentProfile(traits, new Rng(mixSeed(world.seed, id, 0x7c0d))),
  };
  world.personality.set(id, p);
  return p;
}

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
    // appeal = warmth toward them, lifted or lowered by their public STANDING: a
    // renowned soul is a sought-after match, a notorious one shunned even by the fond
    // (REPUTATION_EFFECTS.courtship, pack-tunable). So reputation shapes who you pine for.
    const appeal = computeOpinion(edge, world.tick) + standingOf(world, other) * REPUTATION_EFFECTS.courtship;
    if (appeal > bestOpinion) {
      bestOpinion = appeal;
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

// Opinion thresholds that turn a souring bond into open enmity. They live HERE (not
// only in the courtship resolver) so that BOTH the social loop AND perception (a
// witnessed killing curdling into a feud) escalate animosity through ONE shared rule
// with one source of truth for the numbers. (The positive thresholds — friendship,
// marriage — stay with courtship in systems/resolve.ts.)
export const RIVAL_AT = -190;
export const FEUD_AT = -350;

/** Causes for an enmity milestone: the negative, sourced thoughts on the edge, so
 *  "why are they enemies" traces back to the real moments (a slight, a witnessed
 *  killing). */
function animosityCauses(edge: RelEdge): number[] {
  const out: number[] = [];
  for (const t of edge.thoughts) if (t.cause !== undefined && t.value < 0) out.push(t.cause);
  return out;
}

/**
 * Escalate a souring relationship: if the summed opinion has crossed into rivalry or
 * feud and that flag isn't set yet, set it and emit the milestone (tracing its
 * causes). Idempotent and RNG-FREE — negative escalation has no chance roll, so it is
 * safe to call from perception (off the shared stream) as well as from the resolver.
 * A spouse bond is never silently flipped.
 */
export function escalateAnimosity(world: World, a: EntityId, b: EntityId, edge: RelEdge, precomputedOpinion?: number): void {
  if (edge.flags.spouse) return;
  const v = precomputedOpinion ?? computeOpinion(edge, world.tick);
  if (v <= FEUD_AT && !edge.flags.feud) {
    edge.flags.feud = true;
    edge.flags.rival = true;
    edge.flags.friend = false;
    emit(world, 'feud', [a, b], { ...pickVenue(world, 'feud', a, b) }, animosityCauses(edge));
  } else if (v <= RIVAL_AT && !edge.flags.rival) {
    edge.flags.rival = true;
    edge.flags.friend = false;
    emit(world, 'rivalry', [a, b], {}, animosityCauses(edge));
  }
}

/** Whether this actor currently holds its settlement's ruler seat. */
export function isRuler(world: World, id: EntityId): boolean {
  const h = world.homeSettlement.get(id);
  return h !== undefined && world.settlements[h]?.currentRulerId === id;
}

/** Whether this actor's polity even has a leadership seat to aspire to (not a
 *  leaderless government), AND this Age's Rules still permit a peaceful bid for it — so
 *  the ambition/aspiration offer and what pressClaim actually allows never drift
 *  (design/30 §4.6: the Resolver's illegality must be visible before the player tries). */
export function canSeekRule(world: World, id: EntityId): boolean {
  const h = world.homeSettlement.get(id);
  return h !== undefined && hasLeader(world.settlements[h].governmentId) && world.rules.succession.claimsEnabled;
}
