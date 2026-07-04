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
