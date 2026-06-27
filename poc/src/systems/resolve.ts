/**
 * The RESOLVER — the shared second half of every actor's turn. Given an actor and
 * the Intent it chose (by the NPC decider, or later by player input), apply the
 * effects. This is the ONE rule set: there is no player branch anywhere below.
 *
 * `socialize` reproduces the old `interact()` exactly (the bonded/quarrelled
 * thought, the occasional notable kindness/dispute, then escalation via promote()
 * and the feud brawl). `court` is the same with a positivity bias. `give`/`provoke`
 * apply a guaranteed kindness/slight. `work` grants profession income — currently
 * only reachable once the needs→work loop and the player land (NPC deciders don't
 * emit it yet), so it does not affect the present simulation.
 */
import { type World, type EntityId, type RelEdge } from '../engine/model';
import { type Intent } from '../engine/intent';
import { getRel, emit, isAlive, isKin, clamp, killActor } from '../engine/world';
import { addThought, computeOpinion, pruneThoughts } from '../engine/opinion';
import { pairAffinity } from '../content/fixture';

// Opinion thresholds that escalate a relationship. Tuned to the diminishing-returns
// opinion scale produced by the thought model (see opinion.ts).
const FRIEND_AT = 240;
const RIVAL_AT = -190;
const FEUD_AT = -350;
const MARRY_AT = 310;

const PROFESSION_INCOME: Record<string, number> = {
  farmer: 3,
  smith: 5,
  guard: 4,
  trader: 6,
  healer: 4,
  hunter: 4,
};

/** Apply a chosen intent's effects. ONE rule set — no `if (isPlayer)` below. */
export function resolveIntent(world: World, a: EntityId, intent: Intent): void {
  if (!isAlive(world, a)) return; // may have died earlier this turn (e.g. a brawl)
  switch (intent.kind) {
    case 'idle':
      return;
    case 'work':
      return resolveWork(world, a);
    case 'socialize':
      return resolveInteract(world, a, intent.target, 0);
    case 'court':
      return resolveInteract(world, a, intent.target, 0.15);
    case 'give':
      return resolveGift(world, a, intent.target);
    case 'provoke':
      return resolveProvoke(world, a, intent.target);
  }
}

/**
 * Income earned by plying a profession (a chosen weekly action). The food grant
 * covers several weeks of metabolism (needs.ts decays food ~28/week), so a fed
 * actor only needs to work occasionally and spends the rest of its turns on the
 * social loop — keeping marriages/births healthy while making work a real choice.
 */
function resolveWork(world: World, a: EntityId): void {
  const n = world.needs.get(a)!;
  const prof = world.profession.get(a)!;
  n.food = clamp(n.food + 140, 0, 1000);
  n.wealth = clamp(n.wealth + (PROFESSION_INCOME[prof] ?? 3) * 7, 0, 1000);
}

/**
 * A social encounter. `bias` tilts the odds of it going well (0 = ambient
 * chitchat, >0 = courting). With `bias = 0` this is byte-for-byte the old
 * `interact()`, so the NPC simulation is unchanged.
 */
function resolveInteract(world: World, a: EntityId, b: EntityId, bias: number): void {
  if (!isAlive(world, b)) return;
  const rng = world.rng;
  const edge = getRel(world, a, b);
  pruneThoughts(edge, world.tick);
  const affinity = pairAffinity(world.traits.get(a)!, world.traits.get(b)!);
  const opinion = computeOpinion(edge, world.tick);

  // probability the encounter goes well rises with affinity & existing warmth.
  const pPos = clamp(0.56 + bias + affinity * 0.1 + opinion * 0.00025, 0.05, 0.95);
  const positive = rng.chance(pPos);
  const magnitude = positive ? rng.range(25, 120) : rng.range(20, 105);

  // every encounter leaves a small routine thought (RimWorld's "chitchat")
  addThought(edge, positive ? 'bonded' : 'quarrelled', world.tick);

  // a *notable* encounter is recorded as an event AND a stronger thought — but only
  // while the bond is still forming, so settled relationships don't flood history.
  const settled = edge.flags.friend || edge.flags.spouse || edge.flags.feud;
  if (!settled && magnitude > 95) {
    if (positive && rng.chance(0.12)) {
      addThought(edge, 'kindness', world.tick, { cause: emit(world, 'kindness', [a, b]) });
    } else if (!positive && rng.chance(0.18)) {
      addThought(edge, 'slighted', world.tick, { cause: emit(world, 'dispute', [a, b]) });
    }
  }

  promote(world, a, b, edge);

  // a feud can erupt into violence
  if (edge.flags.feud && rng.chance(0.06)) {
    brawl(world, a, b, edge);
  }
}

/** A deliberate kindness: a guaranteed positive thought, sourced to an event. */
function resolveGift(world: World, a: EntityId, b: EntityId): void {
  if (!isAlive(world, b)) return;
  const edge = getRel(world, a, b);
  addThought(edge, 'kindness', world.tick, { cause: emit(world, 'kindness', [a, b]) });
  promote(world, a, b, edge);
}

/** A deliberate slight: a guaranteed negative thought, sourced to an event. */
function resolveProvoke(world: World, a: EntityId, b: EntityId): void {
  if (!isAlive(world, b)) return;
  const edge = getRel(world, a, b);
  addThought(edge, 'slighted', world.tick, { cause: emit(world, 'dispute', [a, b]) });
  promote(world, a, b, edge);
}

// --------------------------------------------- relationship escalation -------
// (moved verbatim from social.ts; unchanged behaviour)

/** Causes for a relationship-milestone event: the recorded thoughts of the
 *  matching sign, so "why are they friends/enemies" traces to real moments. */
function thoughtCauses(edge: RelEdge, positive: boolean): number[] {
  const out: number[] = [];
  for (const t of edge.thoughts) {
    if (t.cause === undefined) continue;
    if (positive ? t.value > 0 : t.value < 0) out.push(t.cause);
  }
  return out;
}

function promote(world: World, a: EntityId, b: EntityId, edge: RelEdge): void {
  if (edge.flags.spouse) return;
  const v = computeOpinion(edge, world.tick);

  if (v >= MARRY_AT && eligibleToMarry(world, a, b)) {
    marry(world, a, b, edge);
    return;
  }
  if (v >= FRIEND_AT && !edge.flags.friend) {
    edge.flags.friend = true;
    edge.flags.rival = false;
    edge.flags.feud = false;
    emit(world, 'friendship', [a, b], {}, thoughtCauses(edge, true));
  } else if (v <= FEUD_AT && !edge.flags.feud) {
    edge.flags.feud = true;
    edge.flags.rival = true;
    edge.flags.friend = false;
    emit(world, 'feud', [a, b], {}, thoughtCauses(edge, false));
  } else if (v <= RIVAL_AT && !edge.flags.rival) {
    edge.flags.rival = true;
    edge.flags.friend = false;
    emit(world, 'rivalry', [a, b], {}, thoughtCauses(edge, false));
  }
}

function eligibleToMarry(world: World, a: EntityId, b: EntityId): boolean {
  const ia = world.identity.get(a)!;
  const ib = world.identity.get(b)!;
  if (ia.sex === ib.sex) return false; // PoC simplification: opposite-sex for reproduction
  if (world.ties.get(a)!.spouse !== undefined) return false;
  if (world.ties.get(b)!.spouse !== undefined) return false;
  if (isKin(world, a, b)) return false;
  return world.rng.chance(0.4);
}

function marry(world: World, a: EntityId, b: EntityId, edge: RelEdge): void {
  world.ties.get(a)!.spouse = b;
  world.ties.get(b)!.spouse = a;
  edge.flags.spouse = true;
  edge.flags.friend = true;
  edge.flags.feud = false;
  edge.flags.rival = false;
  addThought(edge, 'wed', world.tick); // permanent, strong positive
  emit(world, 'married', [a, b], {}, thoughtCauses(edge, true));
}

function brawl(world: World, a: EntityId, b: EntityId, edge: RelEdge): void {
  const brawlId = emit(world, 'brawl', [a, b], {}, thoughtCauses(edge, false));

  // someone may die; most brawls are non-lethal
  if (!world.rng.chance(0.45)) return;
  const victim = world.rng.chance(0.5) ? a : b;
  const killer = victim === a ? b : a;
  killActor(world, victim, world.tick, 'died_brawl', [killer], [brawlId]);
}
