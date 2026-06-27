/**
 * Social system — runs weekly. This is where emergence lives.
 *
 * Each adult may interact with another actor; the outcome (shaped by trait
 * affinity, current opinion, and seeded RNG) adds a sourced **thought** to their
 * relationship. Opinion is the diminishing-returns sum of active thoughts, so a
 * relationship is legible (you can list the reasons) and emergent (small
 * interactions accrue, stack, and fade). Crossing opinion thresholds promotes the
 * bond to friendship / rivalry / feud / marriage and emits a structured event
 * whose `causes` point back to the kindnesses & slights that built it.
 */
import { type World, type EntityId, type RelEdge, ADULT_AGE } from '../engine/model';
import { fullActors, getRel, emit, isKin, clamp } from '../engine/world';
import { addThought, computeOpinion, pruneThoughts } from '../engine/opinion';
import { pairAffinity } from '../content/fixture';

// Thresholds are tuned to the opinion scale produced by the thought model (bonds
// saturate via diminishing returns, so these sit lower than a raw running total).
const FRIEND_AT = 240;
const RIVAL_AT = -190;
const FEUD_AT = -350;
const MARRY_AT = 310;

function isAdult(world: World, id: EntityId): boolean {
  return world.lifecycle.get(id)!.ageYears >= ADULT_AGE;
}

export function socialWeekly(world: World): void {
  const adults = fullActors(world).filter((id) => isAdult(world, id));
  if (adults.length < 2) return;

  for (const a of adults) {
    if (!world.lifecycle.get(a)!.alive) continue; // may have died in a brawl this pass
    if (!world.rng.chance(0.55)) continue;

    const b = choosePartner(world, a, adults);
    if (b === undefined) continue;

    interact(world, a, b);
  }
}

/** Strongly prefer existing acquaintances so relationships actually DEEPEN into
 *  friendships/marriages (a bounded social circle), only occasionally meeting
 *  someone new. Without this, interactions spread thin and no bond matures. */
function choosePartner(world: World, a: EntityId, adults: EntityId[]): EntityId | undefined {
  const known = world.rels.get(a)!;
  if (known.size > 0 && world.rng.chance(0.88)) {
    const ids = [...known.keys()].filter((id) => world.lifecycle.get(id)!.alive);
    if (ids.length) return ids[world.rng.int(ids.length)];
  }
  for (let tries = 0; tries < 4; tries++) {
    const cand = adults[world.rng.int(adults.length)];
    if (cand !== a && world.lifecycle.get(cand)!.alive) return cand;
  }
  return undefined;
}

function interact(world: World, a: EntityId, b: EntityId): void {
  const rng = world.rng;
  const edge = getRel(world, a, b);
  pruneThoughts(edge, world.tick);
  const affinity = pairAffinity(world.traits.get(a)!, world.traits.get(b)!);
  const opinion = computeOpinion(edge, world.tick);

  // probability the encounter goes well rises with affinity & existing warmth.
  // Baseline tilts slightly positive so most bonds warm over time and feuds stay
  // the dramatic exception.
  const pPos = clamp(0.56 + affinity * 0.1 + opinion * 0.00025, 0.05, 0.95);
  const positive = rng.chance(pPos);
  const magnitude = positive ? rng.range(25, 120) : rng.range(20, 105);

  // every encounter leaves a small routine thought (RimWorld's "chitchat")
  addThought(edge, positive ? 'bonded' : 'quarrelled', world.tick);

  // a *notable* encounter is recorded as an event AND a stronger thought — but
  // only while the bond is still forming, so settled relationships don't flood
  // the history with repeats.
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

/** Shared kill path (also used by lifecycle for natural death). */
export function killActor(
  world: World,
  id: EntityId,
  tick: number,
  type: 'died' | 'died_brawl',
  others: EntityId[],
  causes: number[],
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
