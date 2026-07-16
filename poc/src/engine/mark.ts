/**
 * MARK — the substrate of subjectivity.
 *
 * This module owns lifecycle ONLY: create-time filtering, expiry, and indexing of the
 * sourced, decaying marks that every subjective system holds. A Mark carries a `kind`,
 * a birth tick, an optional expiry, and a cause — and NOTHING about what it means.
 *
 * It must never:
 *   - interpret payload            (it cannot even see `value`, `witnesses`, …)
 *   - score marks                  (no diminishing returns, no witness weighting)
 *   - compare meanings             (no "is this better than that")
 *   - know domain vocabulary       (no Thought, Reputation, Belief, Evidence)
 *   - perform domain-specific reduction
 *
 * If a function needs to know what a mark MEANS, it belongs elsewhere: sentiment in
 * opinion.ts, standing in reputation.ts, belief (later) in its own module. Each is a
 * separate consumer of this substrate with its own reducer. The substrate stays boring
 * on purpose — it should remain almost ignorant, and grow almost never.
 */
import { type Mark } from './model';

/**
 * One human-readable contribution behind a derived value, strongest first — the shape
 * every subjective system's explanation returns: opinionReasons (opinion.ts), standingReasons
 * (reputation.ts), moodReasons (mood.ts), beliefReasons (belief.ts). Living here, not in any one
 * consumer, is what lets the UI render all four through a single component (Inspector's
 * ReasonsList) instead of one bespoke block per subsystem.
 *
 * CONVENTION: a `<domain>Reasons(<source>, tick, limit?)` function aggregates that domain's
 * active marks into rows like this, sorted by `Math.abs(value)` descending, sliced to `limit`.
 * `moodReasons` is the one exception in shape (it takes `world, id` — mood draws on several
 * mark stores at once) but returns the same `Reason[]` and follows the same sort/limit rule.
 */
export interface Reason {
  label: string;
  value: number;
}

/** A mark is active if it has not yet expired. Permanent marks (no expiry) never lapse. */
export function isActive(m: Mark, tick: number): boolean {
  return m.expiresTick === undefined || m.expiresTick > tick;
}

/** The active subset, in input order. Ordering for a fold is the caller's concern. */
export function activeMarks<T extends Mark>(marks: T[], tick: number): T[] {
  return marks.filter((m) => isActive(m, tick));
}

/**
 * Drop expired marks, returning the pruned list. Returns the SAME array reference when
 * nothing has expired (a cheap no-op), or a new filtered array otherwise. Callers that
 * store the result (`x.marks = dropExpired(x.marks, tick)`) get correct behaviour either
 * way; the identity shortcut just avoids needless allocation on the common path.
 */
export function dropExpired<T extends Mark>(marks: T[], tick: number): T[] {
  return marks.some((m) => !isActive(m, tick)) ? marks.filter((m) => isActive(m, tick)) : marks;
}

/**
 * Index marks by a caller-supplied key, preserving input order within each bucket (Map keeps
 * insertion order of keys, so a downstream fold is deterministic). The substrate stays ignorant:
 * WHAT the key means is the consumer's concern — this only buckets and preserves order. A
 * consumer that groups by something richer than `kind` (belief.ts distinguishes a retelling that
 * changed the story from a plain one) reuses this rather than hand-rolling a Map.
 */
export function indexBy<T extends Mark>(marks: T[], key: (m: T) => string): Map<string, T[]> {
  const by = new Map<string, T[]>();
  for (const m of marks) {
    const k = key(m);
    const arr = by.get(k);
    if (arr) arr.push(m);
    else by.set(k, [m]);
  }
  return by;
}

/** Index marks by their `kind` — the common case of `indexBy`. */
export function indexByKind<T extends Mark>(marks: T[]): Map<string, T[]> {
  return indexBy(marks, (m) => m.kind);
}
