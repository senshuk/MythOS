# 36 — Bindings v1: Oaths that outlive their swearers (ADR)

**Document type:** ADR for the implemented slice of `30-mythic-layer.md` §4.3 — the
mythic layer's ONE genuinely new Construct, prototyped smallest and frozen fastest
(Prime Movers' growth law), exactly because it is the one item that could not be a
producer/consumer of an existing primitive.
**Status:** Implemented (v1). Scope fence below.
**Companion documents:** `30` §4.3 (the design case and why nothing existing reduces to
this shape), `17` (Belief — the sibling whose laws this Construct mirrors), `34` (the
loop whose institutions may later carry these).

## 1. The Construct

`Binding { id, kind, subject, carriers[], inheritable, sinceTick, resolvedTick?, cause }`
(engine/model.ts; save v30). An oath, curse, or vow constraining FUTURE reasoning across
time and generations. Laws, all held in `engine/binding.ts`:

- **A Binding never fires an action.** It only WEIGHTS or FORBIDS candidate Intents at
  the Reasoning stage — `Belief → Reasoning, never Belief → Reality`, applied to vows.
  `systems/decide.ts` consults `bindingForbids` on the intents it is about to produce
  (no gift, no courtship, no idle chat with the sworn quarry — the actor falls through
  to its next inclination) and `bindingUrge` for the pull to face a living, co-located
  quarry (the policy and its own dice decide whether today is the day).
- **What a kind of binding means is pack data** (`BINDING_CONSTRAINTS`): pure predicates
  over a candidate Intent. This fantasy pack ships `vengeance` (forbid warmth, urge
  confrontation) and `peace` (forbid raising a hand). A sci-fi pack's AI directive or a
  wuxia pack's blood vow ride the same Construct unchanged.
- **Inheritance piggybacks on the birth rule the world already has**: a child of any
  carrier of an inheritable, unresolved binding is enrolled at birth
  (`inheritBindings`, one call in `systems/lifecycle.ts`'s bear). One sworn moment,
  centuries of constraint — the v1 proof.
- **Resolution is an event, not an erasure**: when the subject leaves the world the
  binding resolves (`bindingsYearly`, `oath_fulfilled`), the constraint lifts, and the
  record stays — history keeps what the will no longer carries.
- **RNG-free and stream-safe**: swearing, inheriting, forbidding and resolving draw
  nothing; the urge's single die is rolled ONLY for carriers with a live local quarry,
  so every unsworn soul's stream is byte-identical to a world with no oaths at all.

## 2. The organic producer

`engine/reactions.ts` — the belief-reaction layer's documented extension point. When an
actor comes to BELIEVE kin has died and the belief's evidence traces to a brawl with a
killer, a survivor whose innate honor crosses the pack threshold swears VENGEANCE:
inheritable, subject = the killer, cause = the brawl. `Reality → Belief → Binding`,
deterministic: most mourn; the sworn are the exceptional few. Legibility runs the whole
chain — "why did she refuse his company?" resolves through the binding's carriers and
cause to a brawl her grandmother witnessed.

## 3. Scope fence (v1 excludes, deliberately)

- **Prophecy** (`30` §4.3's third face) — a Belief about a future Event, fulfilled by
  correspondence-on-demand; a separate increment on the Belief side, not a Binding.
- **Contested/overlapping bindings** (three heirs, one oath, conflicting claims) — per
  `30`'s own fence.
- **Organization carriers and Location curses** — `carriers[]` already types as any
  addressable id; the succession/occupancy enrollment rules are the later increment.
- **Oath-driven ambitions/decision surfaces for the player** — the constraint binds the
  autopilot today; a "your line's oath" decision surface is presentation to come.

## 4. Decision-filter check

Improves the simulation (the category of history where one sworn act ripples for
centuries); generic (predicates and thresholds are pack data — no oath hardcoded);
data-driven; emergent (which oaths form follows brawls, kinship, and honor, never a
script); legible (constraint → carriers → cause chain, surfaced on the actor card);
the one deliberate new Construct, kept frozen-small; five-years sound (blood vows, AI
directives, geasa — one Construct, many universes).
