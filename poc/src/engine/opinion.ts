/**
 * Opinion-as-thoughts. A relationship is no longer a single opaque number; it is
 * a list of sourced, (mostly) decaying thoughts whose diminishing-returns sum is
 * the effective opinion. This makes relationships legible (you can list the
 * reasons) and emergent (small interactions accrue, stack with saturation, and
 * fade unless renewed) — the RimWorld idea, adapted to MythOS and kept fully
 * deterministic (no wall-clock; expiry is by tick).
 */
import { type RelEdge, type ThoughtKind, type EventId } from './model';
import { thoughtSpec } from '../content/fixture';
import { isActive, activeMarks, dropExpired, indexByKind } from './mark';

/** Add a thought to an edge, pruning expired ones of that kind and enforcing the
 *  per-kind stack limit (oldest evicted first). Optional value/cause overrides. */
export function addThought(
  edge: RelEdge,
  kind: ThoughtKind,
  tick: number,
  opts?: { value?: number; cause?: EventId },
): void {
  const spec = thoughtSpec(kind);
  // drop expired thoughts OF THIS KIND (a per-kind prune — a domain policy, not the
  // substrate's blanket dropExpired: other kinds' lapsed thoughts are left untouched here)
  edge.thoughts = edge.thoughts.filter((t) => t.kind !== kind || isActive(t, tick));
  // enforce stack limit (evict oldest of this kind)
  const sameKind = edge.thoughts.filter((t) => t.kind === kind);
  if (sameKind.length >= spec.stackLimit) {
    let oldest = sameKind[0];
    for (const t of sameKind) if (t.sinceTick < oldest.sinceTick) oldest = t;
    const idx = edge.thoughts.indexOf(oldest);
    if (idx >= 0) edge.thoughts.splice(idx, 1);
  }
  edge.thoughts.push({
    kind,
    value: opts?.value ?? spec.base,
    sinceTick: tick,
    expiresTick: spec.durationTicks === undefined ? undefined : tick + spec.durationTicks,
    cause: opts?.cause,
  });
}

/** Effective opinion: per kind, sum active thoughts with diminishing returns. */
export function computeOpinion(edge: RelEdge, tick: number): number {
  // substrate supplies the active subset and the per-kind index; the diminishing-returns
  // fold below is the opinion domain's own reduction and stays here.
  const byKind = indexByKind(activeMarks(edge.thoughts, tick));
  let sum = 0;
  for (const [kind, arr] of byKind) {
    arr.sort((a, b) => b.sinceTick - a.sinceTick); // newest counts at full weight
    const mult = thoughtSpec(kind).mult;
    let m = 1;
    for (const t of arr) {
      sum += t.value * m;
      m *= mult;
    }
  }
  return clampOpinion(sum);
}

export function clampOpinion(v: number): number {
  return v < -1000 ? -1000 : v > 1000 ? 1000 : v;
}

/** Drop all expired thoughts on an edge (housekeeping to bound memory). */
export function pruneThoughts(edge: RelEdge, tick: number): void {
  edge.thoughts = dropExpired(edge.thoughts, tick);
}

/** The human-readable reasons behind an opinion, strongest first (for the UI). */
export function opinionReasons(edge: RelEdge, tick: number, limit = 6): { label: string; value: number }[] {
  // aggregate active thoughts by kind into one line each, with the diminished total
  const byKind = indexByKind(activeMarks(edge.thoughts, tick));
  const rows: { label: string; value: number }[] = [];
  for (const [kind, arr] of byKind) {
    arr.sort((a, b) => b.sinceTick - a.sinceTick);
    const mult = thoughtSpec(kind).mult;
    let total = 0;
    let m = 1;
    for (const t of arr) {
      total += t.value * m;
      m *= mult;
    }
    const count = arr.length;
    const label = count > 1 ? `${thoughtSpec(kind).label} (×${count})` : thoughtSpec(kind).label;
    rows.push({ label, value: Math.round(total) });
  }
  rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return rows.slice(0, limit);
}
