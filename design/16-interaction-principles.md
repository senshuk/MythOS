# Interaction Principles (Phase 2E guidance)

**Document type:** Engineering note — NOT a constitution. Short, practical guidance to keep
organization↔organization interaction (Phase 2E) from tangling. The frozen constitution is
`11`–`15`; this is a one-page rule sheet layered on top of it.

**Status:** Guidance for 2E. Phase 2 (Organizations: exist → remember → reason → execute)
is **feature-complete — Organizations v1**. No new organization features unless a roadmap
item requires them; otherwise Organizations risk becoming a "god subsystem."

**What has shipped under this guidance** (negotiated trade/non-aggression/tribute pacts,
player-as-party envoys, alliances, formal wars with exhaustion/capitulation/reparations,
and annexation as the first diplomacy-adjacent geography change) is tracked in
`29-subsystem-appendix.md` §5, not here — this file stays a rule sheet, not a changelog.
Deferred next: espionage (intelligence/subversion as a new interaction class).

---

## Why this note exists

2A–2D built the *internal* organizational lifecycle: an org perceives, reasons, forms an
intent, and executes a bounded action on ITSELF and its seat. Phase 2E adds the *external*
layer — orgs interacting with each other (diplomacy, trade, alliances, treaties, espionage,
war). That is where naive designs collapse: the tempting shortcut is "Organization A
directly changes Organization B." It doesn't scale. These principles keep the interaction
layer clean, and they extend the same discipline that carried Phases 1–2 (bounded
knowledge, pure-decide-then-apply, only-outcomes-are-history).

---

## The five principles

1. **Organizations never modify each other directly.** No code path writes to org B from
   org A. A → B coupling scales to nothing. All change flows through an interaction
   resolver, exactly as an actor's turn flows through the intent resolver and an org's
   action flows through `resolve()`/`applyEffects()`.

2. **Interactions are negotiated through an interaction resolver.** The pipeline is a
   proposal, not a command: `A → proposal → B → acceptance/rejection → outcome`. The
   resolver is the one place that reads both parties, decides the outcome, and describes
   the effects (pure), which are then applied — mirroring 2D's decide-then-apply split.

3. **Both organizations perceive the same interaction differently.** Each party evaluates a
   proposal through its OWN bounded perception and worldview (2C), not a global truth. A's
   generous offer may read as a threat to B. There is no omniscient assessment of a deal —
   only each side's view of it (invariant: bounded knowledge, `design/11`, 2C charter).

4. **Every interaction produces two histories, not one.** An interaction is recorded from
   each party's perspective — two Records pointing at the shared Event (the engine already
   supports this: an Event has many subjects; each subject gets its own Record). "A and B
   signed a pact" is one Event; how each remembers it (a triumph, a capitulation) is two
   histories. Only OUTCOMES are history (Execution Constitution invariants 8–9): a proposal
   made and rejected may be history; a proposal merely *considered* is not.

5. **Geography changes require explicit world actions, not diplomacy.** An interaction can
   agree to a border, a vassalage, a tribute — but the map only changes through the same
   explicit, gated world actions that 2D deferred (found/annex/raze/relocate). Diplomacy
   produces intent-to-change and agreements; it never mutates settlements/positions itself.
   This keeps the "may change organizations, not geography" boundary intact one layer up.

---

## The interaction pipeline (expected shape for 2E)

```
Organization A            (proposer — acts on its current intent, 2C/2D)
      │  propose (an offer described as data, like OrgEffect descriptors)
      ▼
Interaction Proposal      (a structured, inspectable offer — never a direct mutation)
      │
      ▼
Organization B            (evaluates through ITS OWN perception + worldview, 2C)
      │  accept / reject / counter
      ▼
Interaction Resolver      (PURE: reads both sides, decides the outcome, DESCRIBES effects)
      │  applyEffects (the only mutator)  +  emit ONE Event
      ▼
Two Histories             (a Record for A and a Record for B, both citing the Event)
```

NOT:

```
Organization A ──directly mutates──► Organization B      ✗ (does not scale)
```

The first shape scales to diplomacy, trade, alliances, espionage, treaties, and war. The
second scales to nothing.

---

## What this reuses (don't reinvent)

- **Pure decide, then apply** — the `resolve()` / `applyEffects()` split from `orgAction.ts`.
  An interaction resolver is the two-party version.
- **Bounded perception + worldview** — `orgReason.ts` (`perceive`, `worldviewOf`) supplies
  how each party sees the proposal. No new omniscient assessment.
- **Structured effect descriptors** — `OrgEffect`; a proposal/outcome is described as data
  before it is applied, so it is inspectable (the same transparency as reasoning).
- **Events with many subjects → per-subject Records** — the existing history model already
  yields "two histories from one Event."
- **Existing inter-settlement relations** — `RegionEdge.relation` is the substrate an
  interaction outcome nudges; org-level relationships (a future `OrgRelationships`) layer
  on top when needed, not before.

---

## Non-goals for the first 2E slice

Same discipline as every prior milestone — one capability at a time. First prove the
*negotiated interaction pipeline* (propose → evaluate → accept/reject → outcome → two
histories) with a few bounded interactions (e.g. a trade pact, a non-aggression pact).
Defer war resolution, espionage, treaties-with-teeth, and anything that changes geography —
those are later slices or their own milestones.
