# 23 — Precepts & Belief Module

The last of the RimWorld storytelling lessons (design/08): the **Ideoligion** — a belief
system that holds **precepts**, named moral rules that EMIT thoughts (approval, outrage,
guilt, pride) when an actor witnesses or commits a deed the creed cares about. It is the
natural consumer of the mood system (design/22).

**STATUS: Stages 1, 2 & 3 SHIPPED (2026-07-09).**
- **Stage 1** — precepts subsume the ethics map (one source of truth); a witnessed deed lays
  a self-thought on the doer (guilt) and witnesses (moral outrage) → mood. Over 40 grim years
  a Green Way town carried guilt/outrage while an Iron Creed one stayed at 0/0.
- **Stage 2** — belief now produces PRIDE, and each creed has a distinct moral fingerprint.
  Per-creed VIRTUE precepts on the positive deeds (reconciliation, valor) — the Iron Creed
  reveres valour but is unmoved by peacemaking; the Green Way reveres peace; the Old Faith
  reveres both. And NPC GENEROSITY: a warm, well-provided soul now gives to someone dear (the
  everyday virtue), spending real wealth so it self-limits — which is what makes `edified`/
  `righteous` a regular felt thing (~800 gifts / 25y; the Old Faith carries edified/righteous
  from constant almsgiving; the Iron Creed feels no pride in giving — coherent). 250 tests
  green; no determinism re-anchoring needed.
- **Stage 3** — belief judges how you LIVE, not just what you do, and each creed's outlook is
  legible. STATE PRECEPTS (a yearly RNG-free scan) lay an ongoing `at_peace`/`disquiet` on a
  soul while a life-state holds: the Iron Creed blesses renown (its once-spare conscience now
  touches every warrior), the Green Way frets at hoarding, the Maker Folk are at peace when
  prosperous, the Old Faith grieves a childless elder, free folk chafe at destitution. And the
  creed's moral character is surfaced (`creedOf` → the settlement panel's "reveres … · abhors …").
  258 tests green; no save bump.

## Why now / what it adds

MythOS already has **half** of this, and never noticed:
- [`Culture.ethics`](../poc/src/content/fixture.ts) is a per-deed severity map
  (`bloodshed: 2.4` for the Green Way, `0.5` for the Iron Creed) — a primitive precept table.
- [`witnessDeed`](../poc/src/engine/perception.ts) already reads `ethicsWeightFor`, emits an
  opinion-thought **toward the doer** (`tabooHorror`/`feared`/`admired`), scales standing, and
  fires a `condemned` event past the "profanity" threshold.

The gap: **belief never touches your own conscience.** The ethics path produces only an
opinion *of the doer* and a standing number. Nobody feels moral **outrage, guilt, or pride** —
there is no self-thought. That is the Ideoligion core, and the [mood system](../poc/src/engine/mood.ts)
(self-thoughts → mood → mental breaks, design/22) is the ready consumer. Precepts close the
loop: **belief → feeling → behavior.**

Also missing: named first-class precepts (only a flat multiplier over 3 deed kinds); virtues
(only `generosity` is positive); and any distinction between *doing* a deed (guilt/pride) and
*seeing* it (approval/outrage of the doer).

## Principles

- Precepts are **pack data**; the engine reads a generic table and knows no specific creed.
- A precept **emits thoughts — it never commands an action** (org-intent discipline: belief
  emits; behavior flows through mood/opinion/the existing decider). No `if(isPlayer)`, no new
  agency path.
- **Separate from [`belief.ts`](../poc/src/engine/belief.ts)** — that is the subjective "what *is*"
  (facts/truth, design/17); precepts are the "what *ought*" (values). Do not conflate.
- **Additive**: precepts SUBSUME the `ethics` map (one source of truth), so the taboo/
  condemnation/standing path keeps working unchanged.
- **Legible**: every moral feeling traces to `(precept, deed-event)` and shows in the mood reasons.
- Deterministic; self-thoughts already feed the hashed mood state; perception is off the shared
  RNG stream.

## Decisions (locked 2026-07-09)

- **Precepts hang off `Culture`** (`Culture.precepts`), deity stays the patron. Minimal refactor,
  matches where `ethics` already lives. A unified `Ideoligion` object is a later consolidation, not now.
- **Civic vs sacred split**: each precept carries `sacred?: boolean`. Civic precepts (murder is
  wrong) are felt by everyone in the culture; sacred precepts (a profanity against the deity) only
  by the faithful (`world.faith` set). This gives conversion/apostasy real *felt* weight.

## Data model (pack)

```ts
Precept {
  deed: string                          // reacts to a deed/repute kind ('bloodshed','generosity',…)
  socialWeight?: number                 // = the old ethics multiplier (standing/opinion/condemnation)
  sacred?: boolean                      // sacred ⇒ felt only by adherents; civic ⇒ by all of the culture
  witnessSelf?: { kind: string; value: number }  // what an OBSERVER feels  → moral_outrage / edified
  commitSelf?:  { kind: string; value: number }  // what the DOER feels     → guilt / righteous
  witnessOpinion?: { kind: string; value: number; escalates?: boolean } // toward the doer (existing path)
}
Culture.precepts: Precept[]             // subsumes Culture.ethics
ethicsWeightFor(culture, deed) => preceptFor(culture, deed)?.socialWeight ?? 1.0   // one source of truth
```
New `SELF_THOUGHT_SPECS` (mood table): **`moral_outrage`, `edified`, `guilt`, `righteous`**.

## Where it plugs in — all existing seams

1. **`witnessDeed`** (the one injection point): after today's opinion/standing/condemnation logic,
   look up the precept for `(deed, culture)` and additionally emit —
   - `witnessSelf` on each witness (NEW — moral feeling into their mood), gated by `sacred`+faith;
   - `commitSelf` on the doer (NEW — conscience).
2. **Mood**: those self-thoughts land via `addSelfThought` (LOD-gated, serialized v21, hashed).
   A devout witness to a killing carries `moral_outrage` → mood drops → can tip into a break; the
   killer carries `guilt`.
3. **Adherence**: an actor reacts through the precepts of the creed it holds (`faith → deity →
   culture creed`, falling back to culture). Sacred precepts skip the faithless.

## Staging (each shippable + tested)

- **Stage 1 — Precepts as data + conscience.** Subsume `ethics` into `Culture.precepts`; add the 4
  moral self-thoughts; wire `witnessDeed` to emit witness-outrage + doer-guilt alongside the
  existing path. No save bump (reuses `selfThoughts` v21). Payoff: a killer feels guilt, a devout
  onlooker feels outrage, moods move, breaks/behavior shift — visible in the mood "why."
- **Stage 2 — Virtues (SHIPPED).** Per-creed virtue precepts on the positive deeds that fire
  organically (reconciliation, valor), giving each creed a distinct fingerprint; plus NPC
  generosity in the decider (gated on real wealth surplus, warmth-weighted, self-limiting via a
  wealth cost) so the everyday virtue actually populates moods. Adherence (civic vs sacred) was
  already delivered in Stage 1, so it needed no separate pass. Note: the Iron Creed is the
  deliberate morally-spare outlier — it reveres only valour (rare), so its souls are barely moved
  by belief; the other four feel everyday virtue via generosity.
- **Stage 3 (SHIPPED) — State precepts + surfacing.** `StatePrecept` on Culture (a pure `holds`
  over an `ActorLifeState` snapshot the engine gathers — pack data imports no engine module),
  scanned yearly (`statePreceptsYearly` in religion.ts) to lay ongoing `at_peace`/`disquiet`
  self-thoughts, sacred-gated, renewed while the state holds. `creedOf` surfaces each creed's
  reveres/abhors in the settlement panel. The Iron Creed's inert-conscience note is resolved (it
  now blesses renown). Still open for a future pass: richer deed coverage, marrying-out / other
  state precepts, and an actor-level "living rightly with your creed" readout.

## Determinism / persistence / tests

- No save bump for Stage 1 (self-thoughts already v21 + hashed). New precept data is pure.
- perception stays off the shared RNG stream — NPC outcomes byte-identical.
- Tests: precept table contract; `ethicsWeightFor` derives identically from precepts (regression);
  witnessing a profanity emits `moral_outrage` on witnesses + `guilt` on the doer, traced to the
  deed; a devout community's mood measurably drops after a killing while a martial one shrugs;
  determinism + save round-trip.

## Tuning risk

Moral self-thoughts must be strong enough to matter (push toward breaks under duress) yet not so
strong every witnessed scuffle breaks the town. Reuse the mood-tuning discipline (the compressed
diminishing-returns band from design/22): keep values modest, let the diminishing sum saturate.
