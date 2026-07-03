/**
 * The RESOLVER — the shared second half of every actor's turn. Given an actor and
 * the Intent it chose (by the NPC decider, or by player input), apply the effects.
 * This is the ONE rule set: there is no player branch anywhere below.
 *
 * Randomness is supplied by the caller as an explicit `Rng`, never read from a
 * global: NPC turns pass `world.rng` (so behaviour is unchanged), while the player
 * passes a dedicated stream (resolvePlayerIntent) so player randomness never
 * perturbs the NPC stream. Same draw order either way.
 *
 * `socialize` reproduces the old `interact()` exactly (the bonded/quarrelled
 * thought, the occasional notable kindness/dispute, then escalation via promote()
 * and the feud brawl). `court` is the same with a positivity bias. `give`/`provoke`
 * apply a guaranteed kindness/slight. `work` grants profession income.
 */
import { type World, type EntityId, type RelEdge } from '../engine/model';
import { type Intent } from '../engine/intent';
import { Rng } from '../engine/rng';
import { getRel, emit, isAlive, isKin, clamp, killActor, canTakeSpouse } from '../engine/world';
import { ageCompatible, escalateAnimosity } from '../engine/social';
import { witnessDeed, perceiveEvent } from '../engine/perception';
import { standingOf } from '../engine/reputation';
import { addThought, computeOpinion, pruneThoughts } from '../engine/opinion';
import { pairAffinity, valueAlignment, temperamentAffinity, professionIncomeOf, unionViable, REPUTATION_EFFECTS, SUBSISTENCE_NEED, WEALTH_NEED, SOCIAL_NEED } from '../content/fixture';
import { personalityOf } from '../engine/social';
import { resolveExtraAction } from '../content/actions';

// Opinion thresholds that escalate a relationship. Tuned to the diminishing-returns
// opinion scale produced by the thought model (see opinion.ts). The NEGATIVE
// thresholds (rivalry/feud) live in engine/social.ts (escalateAnimosity) so that
// perception — a witnessed killing curdling into a feud — shares the same rule.
const FRIEND_AT = 240;
const MARRY_AT = 310;

/** Nudge an actor's belonging need (companionship is built and frayed socially). */
function bumpBelonging(world: World, id: EntityId, delta: number): void {
  const n = world.needs.get(id);
  if (n) n[SOCIAL_NEED] = clamp(n[SOCIAL_NEED] + delta, 0, 1000);
}

/** Apply a chosen intent's effects, drawing randomness from `rng`. ONE rule set —
 *  no `if (isPlayer)` below. */
export function resolveIntent(world: World, a: EntityId, intent: Intent, rng: Rng): void {
  if (!isAlive(world, a)) return; // may have died earlier this turn (e.g. a brawl)
  const t = intent.target;
  switch (intent.kind) {
    case 'idle':
      return;
    case 'work':
      return resolveWork(world, a);
    case 'socialize':
      if (t !== undefined) resolveInteract(world, a, t, 0, rng);
      return;
    case 'court':
      if (t !== undefined) resolveInteract(world, a, t, 0.15, rng);
      return;
    case 'give':
      if (t !== undefined) resolveGift(world, a, t, rng);
      return;
    case 'provoke':
      if (t !== undefined) resolveProvoke(world, a, t, rng);
      return;
    default:
      // a verb the engine doesn't know — a pack-specific action (content/actions.ts).
      return resolveExtraAction(world, a, intent, rng);
  }
}

/**
 * Resolve the player's intent against the dedicated player RNG stream, so the
 * player's randomness is isolated from the shared settlement stream. Loads the
 * stream cursor, resolves, then writes it back — the same load/run/store pattern
 * the director/geo/figure passes use.
 */
export function resolvePlayerIntent(world: World, a: EntityId, intent: Intent): void {
  const prng = new Rng(world.playerRngState);
  resolveIntent(world, a, intent, prng);
  world.playerRngState = prng.state;
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
  n[SUBSISTENCE_NEED] = clamp(n[SUBSISTENCE_NEED] + 140, 0, 1000);
  n[WEALTH_NEED] = clamp(n[WEALTH_NEED] + professionIncomeOf(prof) * 7, 0, 1000);
}

/**
 * A social encounter. `bias` tilts the odds of it going well (0 = ambient
 * chitchat, >0 = courting). With `bias = 0` and `rng = world.rng` this is
 * byte-for-byte the old `interact()`, so the NPC simulation is unchanged.
 */
function resolveInteract(world: World, a: EntityId, b: EntityId, bias: number, rng: Rng): void {
  if (!isAlive(world, b)) return;
  const edge = getRel(world, a, b);
  pruneThoughts(edge, world.tick);
  // affinity = clashing/kindred TRAITS (specific frictions) + aligned/opposed VALUES (shared
  // worldview) + TEMPERAMENT chemistry (warmth, clashing tempers) — so bonds and grudges have
  // a *character* reason rooted in both what they believe and how they are.
  const pa = personalityOf(world, a);
  const pb = personalityOf(world, b);
  const affinity =
    pairAffinity(world.traits.get(a)!, world.traits.get(b)!) +
    valueAlignment(pa.values, pb.values) +
    temperamentAffinity(pa.temperament, pb.temperament);
  const opinion = computeOpinion(edge, world.tick);

  // probability the encounter goes well rises with affinity & existing warmth — and
  // with how the town REGARDS the other: a renowned soul gets a warm welcome, a
  // notorious one the cold shoulder (REPUTATION_EFFECTS.reception, pack-tunable). This
  // is "who befriends/avoids you" — public standing colouring everyday encounters.
  const pPos = clamp(
    0.56 + bias + affinity * 0.1 + opinion * 0.00025 + standingOf(world, b) * REPUTATION_EFFECTS.reception,
    0.05,
    0.95,
  );
  const positive = rng.chance(pPos);
  const magnitude = positive ? rng.range(25, 120) : rng.range(20, 105);

  // every encounter leaves a small routine thought (RimWorld's "chitchat")
  addThought(edge, positive ? 'bonded' : 'quarrelled', world.tick);
  // companionship is built (or frayed) by spending time together — both feel it
  bumpBelonging(world, a, positive ? 34 : -12);
  bumpBelonging(world, b, positive ? 34 : -12);

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

  promote(world, a, b, edge, rng);

  // a feud can erupt into violence
  if (edge.flags.feud && rng.chance(0.06)) {
    brawl(world, a, b, edge, rng);
  }
}

/** A deliberate kindness: a guaranteed positive thought, sourced to an event. The gift
 *  is also a PUBLIC act — bystanders see it and the giver earns renown (perception). */
function resolveGift(world: World, a: EntityId, b: EntityId, rng: Rng): void {
  if (!isAlive(world, b)) return;
  const edge = getRel(world, a, b);
  const giftId = emit(world, 'kindness', [a, b]);
  addThought(edge, 'kindness', world.tick, { cause: giftId });
  bumpBelonging(world, a, 30);
  bumpBelonging(world, b, 30);
  witnessDeed(world, giftId, a, b, 'generosity'); // public generosity builds standing
  promote(world, a, b, edge, rng);
}

/** A deliberate slight: a guaranteed negative thought, sourced to an event. */
function resolveProvoke(world: World, a: EntityId, b: EntityId, rng: Rng): void {
  if (!isAlive(world, b)) return;
  const edge = getRel(world, a, b);
  addThought(edge, 'slighted', world.tick, { cause: emit(world, 'dispute', [a, b]) });
  bumpBelonging(world, a, -16);
  bumpBelonging(world, b, -16);
  promote(world, a, b, edge, rng);
}

// --------------------------------------------- relationship escalation -------
// (moved verbatim from social.ts; unchanged behaviour, rng now passed in)

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

function promote(world: World, a: EntityId, b: EntityId, edge: RelEdge, rng: Rng): void {
  if (edge.flags.spouse) return;
  const v = computeOpinion(edge, world.tick);

  if (v >= MARRY_AT && eligibleToMarry(world, a, b, rng)) {
    marry(world, a, b, edge);
    return;
  }
  if (v >= FRIEND_AT && !edge.flags.friend) {
    const wasFeud = edge.flags.feud; // warming out of an open feud = a public reconciliation
    edge.flags.friend = true;
    edge.flags.rival = false;
    edge.flags.feud = false;
    const fid = emit(world, 'friendship', [a, b], {}, thoughtCauses(edge, true));
    if (wasFeud) {
      // peacemaking is a public good — both former enemies earn renown, and onlookers
      // think the better of them for laying the feud down.
      witnessDeed(world, fid, a, b, 'reconciliation');
      witnessDeed(world, fid, b, a, 'reconciliation');
    }
  } else {
    // souring side: rivalry / feud thresholds, shared with perception so a witnessed
    // killing and a private falling-out escalate by exactly the same rule.
    escalateAnimosity(world, a, b, edge, v);
  }
}

function eligibleToMarry(world: World, a: EntityId, b: EntityId, rng: Rng): boolean {
  const ia = world.identity.get(a)!;
  const ib = world.identity.get(b)!;
  // reproductive compatibility comes from species DATA (sexes/mode), not a hardcoded
  // opposite-sex rule — same-sex (hermaphroditic) unions are viable; asexual don't wed.
  if (!unionViable(ia.speciesId, ia.sex, ib.speciesId, ib.sex)) return false;
  if (!canTakeSpouse(world, a)) return false;
  if (!canTakeSpouse(world, b)) return false;
  if (isKin(world, a, b)) return false;
  // age compatibility (shared with courtship) — stops teenagers wedding elders
  if (!ageCompatible(world, a, b)) return false;
  return rng.chance(0.4);
}

function marry(world: World, a: EntityId, b: EntityId, edge: RelEdge): void {
  world.ties.get(a)!.spouses.push(b);
  world.ties.get(b)!.spouses.push(a);
  edge.flags.spouse = true;
  edge.flags.friend = true;
  edge.flags.feud = false;
  edge.flags.rival = false;
  addThought(edge, 'wed', world.tick); // permanent, strong positive
  emit(world, 'married', [a, b], {}, thoughtCauses(edge, true));
}

function brawl(world: World, a: EntityId, b: EntityId, edge: RelEdge, rng: Rng): void {
  const brawlId = emit(world, 'brawl', [a, b], {}, thoughtCauses(edge, false));

  // someone may die; most brawls are non-lethal
  if (!rng.chance(0.45)) {
    // a public scuffle: bystanders see two neighbours come to blows (perception is
    // off the shared RNG stream, so this doesn't perturb the NPC simulation).
    witnessDeed(world, brawlId, a, b, 'violence');
    witnessDeed(world, brawlId, b, a, 'violence');
    return;
  }
  const victim = rng.chance(0.5) ? a : b;
  const killer = victim === a ? b : a;
  // killActor returns the death event ID; that's what witnesses remember.
  const deathId = killActor(world, victim, world.tick, 'died_brawl', [killer], [brawlId]);
  witnessDeed(world, deathId, killer, victim, 'bloodshed');
  if (deathId >= 0) perceiveEvent(world, deathId); // witnesses come to know the death, not just fear the killer
}
