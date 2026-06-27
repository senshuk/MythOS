/**
 * Emergent aspirations. An actor's current goal is a PURE FUNCTION of its state —
 * needs, family ties, relationships, traits, age, station — not a scripted quest.
 * The same derivation drives two things:
 *
 *   - the PLAYER sees it as their objective (text-adventure wisdom: a world with no
 *     goal loses the player), and
 *   - NPCs PURSUE it (decide.ts), turning the reactive social loop into character
 *     arcs — the player and NPCs use the identical rule ("every character is equal").
 *
 * Because it's derived (no stored state), it needs no serialization and can never
 * desync; as the world changes, an actor's aspiration changes with it (find a
 * spouse → start a family → be remembered), which is the sense of progress.
 */
import { type World, type EntityId } from './model';
import { computeOpinion } from './opinion';
import { isKin, fullName, emit } from './world';
import { maturityOf, elderhoodOf, fertileWindowOf, ambitionOf } from '../content/fixture';

export type AspirationKind =
  | 'survive'
  | 'prosper'
  | 'wed'
  | 'family'
  | 'reconcile'
  | 'rule'
  | 'belonging'
  | 'legacy'
  | 'content';

export interface Aspiration {
  kind: AspirationKind;
  target?: EntityId;
  /** the action that pursues this goal (decide.ts maps it to an Intent). */
  action: 'work' | 'court' | 'socialize' | 'idle';
}

const CRUSH_WARMTH = 120; // opinion that marks a real fondness (vs an acquaintance)

/** Whether two actors are a plausible marriage match (each adult by THEIR OWN
 *  species' maturity; wider gaps allowed later in life). Shared by courtship (who
 *  you pine for) and the wedding gate, so actors only pursue partners they could
 *  actually marry. */
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
function bestSuitor(world: World, id: EntityId): EntityId | undefined {
  const me = world.identity.get(id)!;
  if (world.ties.get(id)!.spouse !== undefined) return undefined;
  let best: EntityId | undefined;
  let bestOpinion = CRUSH_WARMTH;
  for (const [other, edge] of world.rels.get(id)!) {
    const olc = world.lifecycle.get(other);
    if (!olc?.alive) continue;
    const oi = world.identity.get(other);
    if (!oi || oi.sex === me.sex) continue; // PoC: opposite-sex marriage
    if (world.ties.get(other)!.spouse !== undefined) continue;
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
function strongestFeud(world: World, id: EntityId): EntityId | undefined {
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

function isRuler(world: World, id: EntityId): boolean {
  const h = world.homeSettlement.get(id);
  return h !== undefined && world.settlements[h]?.currentRulerId === id;
}

/**
 * The actor's current aspiration. Priority follows a life arc: stay alive, make a
 * living, find a partner, raise a family, settle grudges, seek standing, find
 * belonging, leave a legacy — falling back to a quiet life.
 */
export function currentAspiration(world: World, id: EntityId): Aspiration {
  const needs = world.needs.get(id);
  const lc = world.lifecycle.get(id);
  const ties = world.ties.get(id);
  const idn = world.identity.get(id);
  if (!needs || !lc || !ties || !idn) return { kind: 'content', action: 'socialize' };
  const traits = world.traits.get(id) ?? [];

  // thresholds match decide.ts's subsistence gate, so a hungry actor's surfaced
  // goal and its forced action agree.
  if (needs.food < 300) return { kind: 'survive', action: 'work' };
  if (needs.wealth < 250) return { kind: 'prosper', action: 'work' };

  if (lc.ageYears >= maturityOf(idn.speciesId) && ties.spouse === undefined) {
    const crush = bestSuitor(world, id);
    return crush !== undefined
      ? { kind: 'wed', target: crush, action: 'court' }
      : { kind: 'wed', action: 'socialize' };
  }

  if (ties.spouse !== undefined && ties.children.length === 0 && lc.ageYears <= fertileWindowOf(idn.speciesId)[1]) {
    return { kind: 'family', target: ties.spouse, action: 'socialize' };
  }

  const feud = strongestFeud(world, id);
  if (feud !== undefined) return { kind: 'reconcile', target: feud, action: 'socialize' };

  // ambition (data-driven): those whose traits carry a drive to lead, and who do
  // not yet rule, strive to build standing. The engine reads `ambition`, never a
  // specific trait name.
  if (ambitionOf(traits) > 0 && !isRuler(world, id)) return { kind: 'rule', action: 'work' };

  if (needs.belonging < 250 || (world.rels.get(id)?.size ?? 0) < 2) {
    return { kind: 'belonging', action: 'socialize' };
  }

  if (lc.ageYears >= elderhoodOf(idn.speciesId)) return { kind: 'legacy', action: 'socialize' };

  return { kind: 'content', action: 'socialize' };
}

/** Did the player actually attain `prev` (vs merely shifting to a new goal)? Only
 *  positive life milestones count — survive/prosper/belonging/legacy are ongoing,
 *  not "achievements". */
function isFulfilled(world: World, id: EntityId, prev: { kind: string; target?: EntityId }): boolean {
  const ties = world.ties.get(id)!;
  switch (prev.kind) {
    case 'wed':
      return ties.spouse !== undefined;
    case 'family':
      return ties.children.length > 0;
    case 'reconcile': {
      // genuine reconciliation: the former rival is alive and the feud has cleared
      // (feud only clears by warming back into friendship — see resolve.ts promote).
      if (prev.target === undefined) return false;
      const edge = world.rels.get(id)?.get(prev.target);
      return !!edge && !edge.flags.feud && world.lifecycle.get(prev.target)?.alive === true;
    }
    case 'rule': {
      const h = world.homeSettlement.get(id);
      return h !== undefined && world.settlements[h]?.currentRulerId === id;
    }
    default:
      return false;
  }
}

/**
 * Detect when the controlled actor fulfils its goal and emit a celebratory
 * `goal_met` event. Baselines silently on the first call after possession (so a
 * fresh possession never spuriously fires). Deterministic; player-only. The fresh
 * goal then emerges on its own, since aspirations are derived from state.
 */
export function checkPlayerGoal(world: World): void {
  const id = world.playerId;
  if (id === undefined || !world.identity.has(id) || !world.lifecycle.get(id)?.alive) {
    world.playerGoal = undefined;
    return;
  }
  const curr = currentAspiration(world, id);
  const prev = world.playerGoal;
  if (prev !== undefined && prev.kind !== curr.kind && isFulfilled(world, id, prev)) {
    emit(world, 'goal_met', [id], prev.target !== undefined ? { goal: prev.kind, target: prev.target } : { goal: prev.kind });
  }
  world.playerGoal = { kind: curr.kind, target: curr.target };
}

/** A player-facing one-line description of an aspiration. */
export function aspirationLabel(world: World, id: EntityId, asp: Aspiration): string {
  const name = (t?: EntityId) => (t !== undefined ? fullName(world, t) : 'someone');
  switch (asp.kind) {
    case 'survive':
      return 'Stave off hunger';
    case 'prosper':
      return 'Build a livelihood';
    case 'wed':
      return asp.target !== undefined ? `Win the heart of ${name(asp.target)}` : 'Find someone to marry';
    case 'family':
      return 'Start a family';
    case 'reconcile':
      return `Make peace with ${name(asp.target)}`;
    case 'rule': {
      const h = world.homeSettlement.get(id);
      const place = h !== undefined ? world.settlements[h]?.name ?? 'the village' : 'the village';
      return `Rise to lead ${place}`;
    }
    case 'belonging':
      return 'Find true friends';
    case 'legacy':
      return 'Be remembered in the village';
    case 'content':
      return 'Live a good and quiet life';
  }
}
