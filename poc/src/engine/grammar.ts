/**
 * A tiny weighted, recursive symbol-rewriting grammar — the RimWorld RulePack
 * idea as a reusable engine primitive. A grammar maps symbols to weighted
 * productions; a production is literal text that may reference other symbols as
 * `[symbol]`. Generation expands a root symbol, picking productions by weight and
 * recursively expanding references, with caller-supplied bindings injected for
 * dynamic values (`[event]`, `[VICTIM]`, …).
 *
 * Deterministic: it draws only from the injected `Rng`. Callers that render in a
 * read-only context (e.g. building a snapshot) seed a *local* Rng from a stable
 * key (an event id), so the same thing is always narrated the same way.
 */
import { Rng } from './rng';

/** A production is text, or [text, weight] (default weight 1). */
export type Production = string | readonly [string, number];
export type GrammarRules = Record<string, readonly Production[]>;

const REF = /\[([A-Za-z_]\w*)\]/g;

export function expand(
  rules: GrammarRules,
  symbol: string,
  rng: Rng,
  bindings: Record<string, string> = {},
  depth = 0,
): string {
  // a binding wins over a rule (this is how dynamic values are injected)
  if (bindings[symbol] !== undefined) return bindings[symbol];

  const prods = rules[symbol];
  if (!prods || prods.length === 0 || depth > 24) return '';

  const weights = prods.map((p) => (typeof p === 'string' ? 1 : p[1]));
  const pick = prods[rng.weightedIndex(weights)];
  const text = typeof pick === 'string' ? pick : pick[0];

  return text.replace(REF, (_m, sym: string) => expand(rules, sym, rng, bindings, depth + 1));
}
