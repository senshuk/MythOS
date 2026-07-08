/**
 * MOOD — how an actor's own life feels, and what a mind does when it collapses.
 * The RimWorld pillar adapted to MythOS: mood is the diminishing-returns sum of
 * sourced, decaying SELF-THOUGHTS (grief, joy, humiliation — the same Mark machinery
 * as opinion-thoughts, held about one's own life) plus SITUATIONAL feelings derived
 * from the needs of the moment, on top of a temperament BASELINE (some souls simply
 * run brighter). Fully legible: `moodReasons` lists every contribution.
 *
 * When mood falls below a temperament-set threshold, each week risks a MENTAL BREAK:
 * the intent producer (NPC decider or the player seam) is preempted by a forced
 * intent — lash out, withdraw, binge — resolved by the ONE shared resolver. There is
 * no player branch: a broken mind takes the turn from anyone. Deterministic: state +
 * the caller's RNG stream, no wall-clock.
 */
import { type World, type EntityId, type Thought, type EventId } from './model';
import { type Intent } from './intent';
import { Rng } from './rng';
import { isActive, activeMarks, dropExpired, indexByKind } from './mark';
import { computeOpinion } from './opinion';
import { personalityOf } from './social';
import {
  selfThoughtSpec,
  moodBaseline,
  breakThreshold,
  MOOD_NEED_WEIGHTS,
  MOOD_NEED_BAND_FACTOR,
  MOOD_FEELS,
  NEED_FEELS,
  NEED_FEELS_GENERIC,
  BREAKS,
  BREAK_CHANCE_MAX,
} from '../content/fixture';

/** Neutral mood — the centre of the 0..1000 scale (same convention as needs). */
export const MOOD_NEUTRAL = 500;

export function clampMood(v: number): number {
  return v < 0 ? 0 : v > 1000 ? 1000 : v;
}

/**
 * Add a self-thought to an actor. A silent no-op for actors that hold no mood state
 * (aggregate/summary fidelity) — LOD policy stays at this one gate, so every caller
 * can emit unconditionally at the site of the deed.
 */
export function addSelfThought(
  world: World,
  id: EntityId,
  kind: string,
  opts?: { value?: number; cause?: EventId },
): void {
  const marks = world.selfThoughts.get(id);
  if (!marks) return;
  const spec = selfThoughtSpec(kind);
  const tick = world.tick;
  // per-kind prune + stack limit (oldest evicted) — the addThought policy, on the self
  let kept = marks.filter((t) => t.kind !== kind || isActive(t, tick));
  const sameKind = kept.filter((t) => t.kind === kind);
  if (sameKind.length >= spec.stackLimit) {
    let oldest = sameKind[0];
    for (const t of sameKind) if (t.sinceTick < oldest.sinceTick) oldest = t;
    kept = kept.filter((t) => t !== oldest);
  }
  kept.push({
    kind,
    value: opts?.value ?? spec.base,
    sinceTick: tick,
    expiresTick: spec.durationTicks === undefined ? undefined : tick + spec.durationTicks,
    cause: opts?.cause,
  });
  world.selfThoughts.set(id, kept);
}

/** Drop expired self-thoughts (housekeeping, bounds memory). */
export function pruneSelfThoughts(world: World, id: EntityId): void {
  const marks = world.selfThoughts.get(id);
  if (marks) world.selfThoughts.set(id, dropExpired(marks, world.tick));
}

const needBand = (v: number) => (v < 200 ? 0 : v < 400 ? 1 : v < 600 ? 2 : v < 800 ? 3 : 4);

/** The situational contributions of the moment: each need, felt (derived, never stored). */
function situationalRows(world: World, id: EntityId): { label: string; value: number }[] {
  const needs = world.needs.get(id);
  if (!needs) return [];
  const rows: { label: string; value: number }[] = [];
  for (const [k, weight] of Object.entries(MOOD_NEED_WEIGHTS)) {
    const band = needBand(needs[k] ?? 0);
    const value = Math.round(weight * MOOD_NEED_BAND_FACTOR[band]);
    if (value === 0) continue;
    const words = NEED_FEELS[k] ?? NEED_FEELS_GENERIC;
    rows.push({ label: words[band].toLowerCase(), value });
  }
  return rows;
}

/** The remembered contributions: active self-thoughts, per kind, diminishing. */
function memoryRows(world: World, id: EntityId): { label: string; value: number }[] {
  const marks = world.selfThoughts.get(id);
  if (!marks || marks.length === 0) return [];
  const byKind = indexByKind(activeMarks(marks as Thought[], world.tick));
  const rows: { label: string; value: number }[] = [];
  for (const [kind, arr] of byKind) {
    arr.sort((a, b) => b.sinceTick - a.sinceTick); // newest counts at full weight
    const spec = selfThoughtSpec(kind);
    let total = 0;
    let m = 1;
    for (const t of arr) {
      total += t.value * m;
      m *= spec.mult;
    }
    const label = arr.length > 1 ? `${spec.label} (×${arr.length})` : spec.label;
    rows.push({ label, value: Math.round(total) });
  }
  return rows;
}

/**
 * Effective mood, 0..1000 (500 = neutral): temperament baseline + situational need
 * feelings + the diminishing sum of remembered self-thoughts.
 */
export function computeMood(world: World, id: EntityId): number {
  let sum = MOOD_NEUTRAL + moodBaseline(personalityOf(world, id).temperament);
  for (const r of situationalRows(world, id)) sum += r.value;
  for (const r of memoryRows(world, id)) sum += r.value;
  return clampMood(sum);
}

/** Mood as a lived word ("Weary", "Bright") — presentation of the number. */
export function moodWord(mood: number): string {
  return MOOD_FEELS[needBand(mood)];
}

/** Every contribution behind a mood, strongest first — legibility (the UI's "why"). */
export function moodReasons(world: World, id: EntityId, limit = 8): { label: string; value: number }[] {
  const rows: { label: string; value: number }[] = [];
  const base = Math.round(moodBaseline(personalityOf(world, id).temperament));
  if (base !== 0) rows.push({ label: base > 0 ? 'a bright nature' : 'a heavy nature', value: base });
  rows.push(...situationalRows(world, id), ...memoryRows(world, id));
  rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return rows.slice(0, limit);
}

/**
 * The weekly mental-break check — ONE rule for every intent producer. Returns the
 * forced intent if the mind breaks this week, else undefined. Callers pass their own
 * RNG stream (NPCs the settlement stream, the player the player stream), so the rule
 * is shared while randomness stays where the producer's randomness already lives.
 */
export function maybeBreak(world: World, id: EntityId, rng: Rng): Intent | undefined {
  if (!world.selfThoughts.has(id)) return undefined; // no mood state at this fidelity
  const temperament = personalityOf(world, id).temperament;
  const threshold = breakThreshold(temperament);
  const mood = computeMood(world, id);
  if (mood >= threshold) return undefined;
  // chance rises linearly from 0 at the threshold to BREAK_CHANCE_MAX at mood 0
  const p = ((threshold - mood) / threshold) * BREAK_CHANCE_MAX;
  if (!rng.chance(p)) return undefined;

  // pick a break, weighted by base weight bent by temperament (deterministic data)
  const weights = BREAKS.map((b) => {
    let w = b.weight;
    for (const [axis, f] of Object.entries(b.temperament ?? {})) {
      w += ((temperament as Record<string, number>)[axis] ?? 0) * (f as number);
    }
    return w < 0 ? 0 : w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.range(0, total);
  let pick = BREAKS[0];
  for (let i = 0; i < BREAKS.length; i++) {
    if (roll < weights[i]) {
      pick = BREAKS[i];
      break;
    }
    roll -= weights[i];
  }

  if (pick.id === 'lash_out') {
    // the mind turns on whoever the heart already resents most (lowest opinion known,
    // ties broken by id — RNG-free, so the target is a legible consequence of history)
    let target: EntityId | undefined;
    let worst = Infinity;
    for (const [other, edge] of world.rels.get(id) ?? []) {
      if (!world.lifecycle.get(other)?.alive) continue;
      const op = computeOpinion(edge, world.tick);
      if (op < worst || (op === worst && (target === undefined || other < target))) {
        worst = op;
        target = other;
      }
    }
    // with no one to resent, a lash-out collapses into withdrawal
    if (target === undefined) return { kind: 'break', mode: 'withdraw' };
    return { kind: 'break', mode: 'lash_out', target };
  }
  return { kind: 'break', mode: pick.id };
}
