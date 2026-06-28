/**
 * Reputation-as-marks — the community-scale sibling of opinion-as-thoughts
 * (opinion.ts). An actor's public STANDING is not a stored number; it is the
 * summed, witness-weighted, (mostly) decaying total of sourced *marks* — the
 * deeds the community actually perceived. This keeps reputation:
 *
 *   - EARNED: a deed only counts once someone witnessed it (perception.ts mints
 *     the mark with the headcount of who saw), so notoriety is a function of
 *     visibility, not a private fact;
 *   - LEGIBLE: the inspector can list *why* someone is feared or renowned
 *     ("shed blood, seen by 7"); and
 *   - EMERGENT & FADING: marks stack and fade, so a long-ago killing weighs less
 *     than a fresh one unless it was momentous (a permanent mark).
 *
 * Fully deterministic (no wall-clock; expiry is by tick), exactly like opinion.ts.
 * What each kind of mark is worth is PACK DATA (content/fixture REPUTE_SPECS).
 */
import { type World, type EntityId, type Reputation, type ReputeMark, type EventId } from './model';
import { reputeSpec } from '../content/fixture';

/** Bound the marks kept on one actor (housekeeping; the deep past lives in events). */
const REPUTE_MARK_LIMIT = 16;

function isActive(m: ReputeMark, tick: number): boolean {
  return m.expiresTick === undefined || m.expiresTick > tick;
}

/**
 * How widely a deed is known, from how many witnessed it. A lone witness still
 * spreads word (floor 0.4); a crowd amplifies; the effect saturates so notoriety
 * can't run away with one very public act.
 */
export function knownFactor(witnesses: number): number {
  const f = 0.4 + witnesses * 0.12;
  return f < 0.4 ? 0.4 : f > 1.6 ? 1.6 : f;
}

export function emptyReputation(): Reputation {
  return { marks: [] };
}

/** An actor's current public standing (0 if they have no reputation record). The
 *  convenience the live systems read so reputation can colour decisions without each
 *  call site re-deriving it. */
export function standingOf(world: World, id: EntityId): number {
  const rep = world.reputation.get(id);
  return rep ? computeStanding(rep, world.tick) : 0;
}

/** Add a sourced mark to an actor's standing, pruning expired marks and bounding
 *  the list (oldest evicted first). Value defaults to the pack spec's base. */
export function addMark(
  rep: Reputation,
  kind: string,
  tick: number,
  opts?: { value?: number; witnesses?: number; cause?: EventId },
): void {
  const spec = reputeSpec(kind);
  rep.marks = rep.marks.filter((m) => isActive(m, tick));
  rep.marks.push({
    kind,
    value: opts?.value ?? spec.base,
    sinceTick: tick,
    expiresTick: spec.durationTicks === undefined ? undefined : tick + spec.durationTicks,
    witnesses: opts?.witnesses ?? 1,
    cause: opts?.cause,
  });
  if (rep.marks.length > REPUTE_MARK_LIMIT) rep.marks.shift();
}

/** Effective standing: witness-weighted sum of active marks (− = notorious, + = renowned). */
export function computeStanding(rep: Reputation, tick: number): number {
  let sum = 0;
  for (const m of rep.marks) {
    if (!isActive(m, tick)) continue;
    sum += m.value * knownFactor(m.witnesses);
  }
  return sum < -1000 ? -1000 : sum > 1000 ? 1000 : sum;
}

/** The human-readable reasons behind a standing, strongest first (for the UI). */
export function standingReasons(rep: Reputation, tick: number, limit = 6): { label: string; value: number }[] {
  const byKind = new Map<string, { value: number }>();
  for (const m of rep.marks) {
    if (!isActive(m, tick)) continue;
    const row = byKind.get(m.kind) ?? { value: 0 };
    row.value += m.value * knownFactor(m.witnesses);
    byKind.set(m.kind, row);
  }
  const rows: { label: string; value: number }[] = [];
  for (const [kind, row] of byKind) rows.push({ label: reputeSpec(kind).label, value: Math.round(row.value) });
  rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return rows.slice(0, limit);
}

/** Drop expired marks (housekeeping to bound memory). */
export function pruneMarks(rep: Reputation, tick: number): void {
  if (rep.marks.some((m) => !isActive(m, tick))) {
    rep.marks = rep.marks.filter((m) => isActive(m, tick));
  }
}
