# MythOS Prime Movers

**Document type:** Engine constitution — the worldview of the simulation itself.
**Companion documents:** `11-simulation-ontology.md` (the nouns), `15-execution-model.md` (the verbs), `17-epistemics-adr.md` (subjective reality).
**Status:** Canonical. This is the map. If a design decision cannot be located on this page, it is either miscategorised or the map is wrong.

---

## Purpose

The ontology explains the **nouns**. The execution model explains the **verbs**. The Epistemics ADR explains how **subjective reality** forms. This document is the one above them — it answers a single question:

> **How does MythOS think?**

It re-cuts the same concepts along the one axis that governs everything else in the engine: **objective vs. subjective**. Read this first. It teaches the engine's worldview faster than any subsystem document can.

---

> ## Reality is simulated. Minds are inferred.

The engine never simulates consciousness. It simulates evidence, memory, reasoning, and action faithfully enough that consciousness *appears* to emerge. Every subjective concept in this document — Belief, opinion, legitimacy, rumor — is an **inference the engine draws from objective evidence**, never a mind it models directly. There is no "mind" object anywhere in MythOS. There is a world, a record of what each entity has sensed and been told, and rules that turn that record into behaviour. The minds are what an observer reads into the gap between the objective world and each entity's evidence of it.

Everything below flows from that sentence.

---

## 1. What exists?

Two layers. Never confuse them.

**Objective reality** — the world as it *is*. One shared truth, immutable once written.

```
Actor          — an agent
Organization   — a collective agent
Location        — a container (Vehicle = a container that moves)
Object         — a historical thing
Event          — an immutable fact about a world-state transition
```

**Subjective reality** — the world as it is *held*. One per entity, and they disagree.

```
Mark           — a sourced, decaying assertion an entity holds (sentiment · reputation · belief)
Relationship   — a bond between entities (its existence is objective; its opinion is a Mark)
Record         — an entity's private pointer into the objective Event log
```

The bridge between the layers is deliberate: **Records point at Events, and Marks assert about them.** History is one. The readings of it are many.

> A Mark can be false. An Event cannot. That single asymmetry is the engine's defining idea.

---

## 2. What changes?

Not everything changes the same way. The *how* is as fixed as the *what*.

| Layer | Changes through |
|---|---|
| **Objective reality** | **Actions only.** An Event is written when — and only when — an Action's attempt or outcome occurs. |
| **Subjective reality** | **Perception, testimony, decay, and reasoning.** Marks form when an entity witnesses, is told, reads, infers, or forgets. |

Reality is changed by *doing*. Belief is changed by *learning* (and by *forgetting*). These are different mechanisms, and the engine must never let one masquerade as the other. Perceiving a thing does not change the thing. Believing a thing does not make it so.

---

## 3. What causes change?

One chain. Every consequence in the simulation flows through it, in this order:

```
Reality
   ↓   perception    (who was in range to sense it)
Perception
   ↓   acquisition   (witness · testimony · document · inference)
Belief
   ↓   valuation     (what the belief means to this entity)
Reasoning
   ↓   deliberation  (worldview → what should I do?)
Intent
   ↓   attempt       (can I do it?)
Action
   ↓   resolution
Outcome
   ↓   emission
History   (→ new Reality)
```

And the rule that guards it:

> ## No system may skip a stage.

Reality never reaches Intent without passing through Belief. A belief never becomes History without passing through Action. There is no `Belief → Reality` shortcut, no `Reality → Reasoning` bypass that skips perception, no Action that fires without an Intent behind it.

This is not a style preference. It is the guarantee that makes the world both **emergent** (every outcome has a traceable cause) and **legible** (every cause can be read back, stage by stage). Every architectural invariant in `15-execution-model.md` (8, 9, and 10) is a fence around one edge of this chain. Skipping a stage is the one mistake from which the simulation cannot recover its own explanation.

---

## 4. Objective vs. subjective

The table that teaches the engine faster than prose:

| Objective (the world) | Subjective (a mind's hold on it) |
|---|---|
| Event | Belief |
| Location | Map / mental model |
| Object | Authenticity ("is this real?") |
| Organization | Legitimacy ("do I recognise it?") |
| Death | Rumor ("is the king truly dead?") |
| Law | Obedience / recognition |
| A relationship exists | The opinion held about it |
| Resource quantity | Perceived scarcity |
| Distance | Reachability, as understood |

The left column is the same for everyone. The right column is different for everyone — and the difference *is* the story. Two actors reading one death diverge; two kingdoms reasoning from one law fracture; two merchants trusting one map end up in two places. MythOS is not the left column alone. It is the widening gap between the columns over time.

---

## The one-line summary

> **MythOS simulates one objective world and many subjective holds on it, and it never lets a mind change the world except by acting in it.**

Everything else — the ontology's categories, the execution model's ordering, the Epistemics ADR's belief mechanics — is an elaboration of that sentence.

---

## How the engine grows

If the sentence above is *how MythOS thinks*, this is *how MythOS is built* — the methodology behind every layer:

> ## Build a minimal primitive, freeze it, and thereafter grow only producers and consumers. The primitive is fixed; the world's use of it grows outward.

Every major layer followed it. `Intent` froze, then behaviours plugged in. `Organization` froze, then reasoning, resources, and interaction plugged in. `Mark` froze, then opinion, reputation, and belief plugged in. `Belief` froze, then witness, testimony, conversation, coronation, mourning, and allegiance plugged in — without one of them reopening the primitive.

This is why the architecture stayed clean while becoming far richer, and why the laws in `11 §Mark` are phrased as **prohibitions** (*derived never stored; reducers read, producers write; a reducer depends only on reducers closer to the substrate*): a frozen primitive is one that new code is forbidden to change, only to *use*. When a new system arrives — espionage, religion, crime, a magic pack's divination — the question is never "what primitive do I add?" It is "is this a **producer** (new evidence enters) or a **consumer** (something reacts)?" That single question, and the refusal to answer it with a new primitive, is the discipline that keeps the engine comprehensible at any size.

---

## Significance is derived, never stored

A law discovered inside the Mythic Layer proposal (`30 §7`), generalized here because it
turned out not to be mythology-specific at all. Every subjective quantity this document
already governs — opinion, standing, belief — is computed on demand from a decaying stack,
never a number that only goes up. The same discipline turns out to be the correct answer
for a wider family of concepts that don't call themselves Marks but have the identical
shape: historical significance, legendary status, sacredness, dynastic prestige,
institutional importance, an artifact's renown.

> ## Significance is never an ontology property. It is always an emergent property of accumulated, ongoing simulation — computed from a decaying stack, exactly like opinion, standing, and belief.

The reasoning is the same reasoning that already governs Mark (`11 §Mark`): a stored
"this is now significant" bit can only accumulate, because nothing is written to
*decrease* it. Left unchecked, every subsystem that grants significance eventually inflates
it — a House that was prestigious a thousand years ago and has done nothing since still
outranks one earning fresh renown today, an object that was in one dramatic event forever
reads as legendary. The fix is not a special case for mythology; it is the same reducer
discipline applied one layer further out: *compute significance from what is currently
still reinforced, not from what was ever true.*

**This is a design law, not yet an enforced one — an audit found a live counter-example.**
`engine/model.ts`'s House `prestige` (`§Dynasties & Houses`, `figures.ts`) is a plain stored
`number`, incremented (`+= HOUSE_FOUND`, `+= HOUSE_CONQUEST`, `+= HOUSE_ASCEND`,
`+= HOUSE_REIGN`) with no decay path anywhere in the engine — exactly the anti-pattern this
law forbids, shipped today. It is flagged here rather than silently patched, because
changing it changes game balance (which lines stay prestigious) and that is a product
decision, not a documentation fix — see the spawned follow-up task. Meanwhile, the engine
already has a correct worked example right beside it: `sim.ts`'s "notable residents"
selection recomputes fresh from live `standingOf()` (a Mark reducer) plus context every
time, never storing "is notable" on an Actor. That is the pattern prestige should converge
toward.

**A follow-up audit widened the search past significance specifically**, checking every
stored numeric field in `engine/model.ts` that could plausibly be standing in for
importance/influence/legitimacy/prosperity, against a two-condition test: a stored value is
legitimate only if (1) it is genuine simulation state that cannot be reconstructed (an
actual accumulated fact, like a treasury), or (2) it is a cache of an expensive derived
computation, refreshed every time it's read, never trusted stale. Anything satisfying
neither is the same bug as `prestige`.

| Field | Verdict | Why |
|---|---|---|
| Settlement/org `wealth` | **Clean** — condition 1 | Genuinely bidirectional: gains from trade/production, spent on tithes and org actions, and actively decays toward its productive base (`lod.ts`: `wealth = wealth * 0.96 + …`). A real accumulated fact, not a disguised significance score. |
| Settlement `stability` | **Clean** — condition 1 | Rises and falls from real events (raids, boons, unrest), mean-reverts (`stability * 0.9 + …`), clamped both directions. Ongoing state, not monotonic. |
| Actor/Org `standing` (View types only) | **Clean** — condition 2 | Never mutated directly anywhere in the engine; every occurrence is populated by calling `computeStanding()` fresh at snapshot time. The live source of truth is the Reputation Mark stack, exactly as designed. |
| The steering Mandate (`design/26` P4) | **Clean** — self-renewing | Explicitly re-evaluated each check against whether the org still rates the intent a contender, and lapses without renewal — the same "must keep being reinforced" shape as a Mark, just not literally one. |
| House `prestige` | **Violation** (already logged above) | The sole exception found. |

One violation in five checked, and the violation was already known — this is evidence the
law describes the codebase's actual, mostly-followed discipline rather than an aspiration
imposed after the fact.

## Admission criteria for this document

As more laws get promoted here — this page has grown from one axis (§1) to five sections
since first written — the risk shifts from "missing a law" to **diluting this document into
a collection of good ideas instead of a compact statement of the engine's deepest
invariants.** Every candidate for promotion into Prime Movers, including the one just added
above, should pass three questions before landing here rather than in a subsystem ADR:

1. Does it explain multiple, otherwise-unrelated systems? (Not just the one that surfaced it.)
2. Would violating it predictably cause architectural problems, not just local bugs?
3. Will it still feel fundamental five years from now, independent of any specific subsystem?

**Applied to "significance is derived, never stored" as a self-check:** *(1)* yes —
reputation, opinion, belief, House prestige, and every future legendary/sacred/attractor
mechanism in `30-mythic-layer.md` all reduce to the same shape, none of which named each
other when the law was found. *(2)* yes — the `prestige` counter-example is a real,
findable class of bug (unbounded inflation), not a cosmetic inconsistency. *(3)* yes — it
does not mention mythology, Objects, or Houses in its statement (§ above); it is phrased at
the same altitude as Observer independence. It passes. A law that only explains one
subsystem, or whose violation would just be "a bit weird" rather than "a class of bug,"
belongs in that subsystem's own ADR instead — this page is for the ones that don't.

## Observer independence (the north star)

"World before player" (CLAUDE.md) has a technical form, and this is it:

> ## Changing what is *simulated* must never change what is *true*.

Level-of-detail is an **optimization** — how finely the engine spends compute — never a **rule of the world**. The camera changes simulation *fidelity*; it must never change *ontology*. A place's truth is defined by the objective fields evolving beneath it — physical transport (people, goods), informational transport (the news frontier, `20`), biological transport (births, deaths, migration) — not by whether anyone is looking. Those fields propagate independently of observation; the subjective simulation is materialized *into* them where minds exist.

**This is a north star, not yet a fact.** The News Frontier (`20`) is the first system built fully to the standard — its acceptance test *is* observer independence ("delete the camera": run 500 years unwatched, focus anywhere, and residents know exactly what reached that place). Older systems only approximate it — aggregate promotion still mints individual identities on focus, so focusing today adds fine-grained truths that did not exist before. Those are the seams to move *toward* the standard, never away from it. If the property holds across the next several systems, MythOS gains something very few simulations possess: a world that exists independently of attention, exactly as the vision demands.

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-03 | Initial capstone. Re-cuts the ontology along the objective/subjective axis (§1), fixes the two change mechanisms — Actions for reality, perception/testimony/decay/reasoning for belief (§2), states the full causal chain Reality → Perception → Belief → Reasoning → Intent → Action → Outcome → History with the governing rule "no system may skip a stage" (§3), and gives the objective-vs-subjective teaching table (§4). Written after `11` (ontology), `15` (execution model), and `17` (Epistemics ADR) as the document that sits above them. |
| 1.1 | 2026-07-03 | Added the project's philosophical thesis as an epigraph: **"Reality is simulated. Minds are inferred."** — the engine models evidence, memory, reasoning, and action, never consciousness; minds are inferred from the gap between the objective world and each entity's evidence of it. |
| 1.2 | 2026-07-03 | Added the engine-wide **development methodology** ("How the engine grows"): *build a minimal primitive, freeze it, and thereafter grow only producers and consumers — the primitive is fixed, its use grows outward.* Promoted from a Belief-specific note (design/19) to the method behind every layer (Intent, Organization, Mark, Belief); explains why the `11 §Mark` laws are phrased as prohibitions. |
| 1.3 | 2026-07-03 | Added **Observer independence** ("the north star"): *changing what is simulated must never change what is true* — the technical form of "world before player". LOD is an optimization, not a rule of the world; objective fields (physical/informational/biological transport) propagate independently of observation, and minds are materialized into them. Stated honestly as a target the News Frontier meets fully and older systems (aggregate promotion) only approximate. |
| 1.4 | 2026-07-12 | Added **Significance is derived, never stored**, promoted from a Mythic Layer-local rule (`30 §7`) once review found it wasn't mythology-specific: historical significance, legendary status, sacredness, dynastic prestige, and institutional importance all belong to the same law already governing Mark (`11 §Mark`) — computed from a decaying stack, never a monotonic stored number. A codebase audit prompted by this promotion found one live counter-example (`House.prestige`, `engine/model.ts`/`figures.ts` — a stored, only-incrementing number with no decay path) and one correct worked example beside it (`sim.ts`'s notable-residents selection, already a fresh reducer over live standing). Stated honestly, per the same convention as Observer independence: a law the engine mostly already follows, with a known, tracked exception rather than a claimed absolute. |
| 1.5 | 2026-07-12 | Widened the audit into a general **derived-state check** (settlement/org wealth, settlement stability, actor/org standing, the steering Mandate) against a two-condition test (genuine irreducible state, or a refreshed cache of a derived computation) — all four clean, `prestige` remaining the sole violation found across five checks. Added **Admission criteria for this document** (a three-question test: explains multiple unrelated systems, violating it causes architectural not cosmetic problems, still fundamental in five years) to guard against this page diluting into a list of good ideas as more laws get promoted here; applied it retroactively to the significance law as a worked self-check. |
