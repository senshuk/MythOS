# 30 — The Mythic Layer

**Document type:** Design proposal — a prioritized set of optional modules that let a
Universe Pack build Tolkien-depth *mythic* history, not just Warsim/RimWorld-depth
*political* history. Written in response to a third-party Tolkien-fidelity critique of
`29-subsystem-appendix.md` (verbatim critique preserved in session history, not
reproduced here).
**Companion documents:** `18-prime-movers.md` (the objective/subjective axis and the
"freeze a primitive, grow only producers/consumers" methodology this whole doc obeys),
`17-epistemics-adr.md` (Belief/Mark — the substrate most of this reuses, including the
still-open distortion fork, §9.6), `11-simulation-ontology.md` (capability-first
classification — the reason several "gaps" below turn out to already be solved),
`28-settlement-legibility.md` (Fortunes — the sibling of §4.6 Decline), `01-warsim-analysis.md`
§1.3 pattern 3 (base+modifier grammar, the mechanism §4.5 Corruption reuses),
`history-generation-gaps` (project memory — the Tolkien/Arda gap analysis this doc extends).
**Status:** Proposed. Nothing here is scheduled. This is a design record and a priority
ranking, not a commitment — each item still needs its own ADR before implementation,
held to the same one-capability-at-a-time discipline as every prior milestone.
**Revision note (v1.1):** a second review pass judged v1.0 architecturally sound but
flagged one recurring pattern — several items modeled *mythology as information* (a
Belief about a thing) where Tolkien's mythology often acts as *a force in history* (a
thing that changes civilizations independent of anyone's belief about it). §4.2, §4.5,
§4.6, and §4.7 are revised below; §4.8–§4.11 are new.
**Revision note (v1.2):** a third pass set Tolkien aside entirely and stress-tested every
item against seven other universes (§5, new), then asked whether the recurring
"persistent historical attractor" pattern (the Ring, the Iron Throne, Chaos, the Reapers,
psychohistory, …) is emergent or a missing primitive — concluded emergent, and proposed a
legibility reducer for it (§6, new) plus an engine-level scarcity law to prevent mythic
inflation (§7, new). See Revision History.

---

## 1. The gap this closes

A gap analysis against the Tolkien/Arda timeline (project memory, `history-generation-gaps`)
already identified MythOS's history generation as strong on *causal* history (who did what
to whom, and why) but missing the categories that make Arda feel *mythic* rather than merely
*deep*: objects as historical agents, divine actors, oaths/prophecy. A closer read against
the full legendarium sharpens *why* those gaps matter and surfaces others: corruption as a
parasitic (not creative) relation, civilizational decline as a metaphysical arc rather than
ordinary attrition, myth mutation (a death becomes a legend becomes a disputed scripture),
symbolic objects, and heroic ages that change what is ontologically possible.

**This document is explicitly not "make MythOS simulate Tolkien."** CLAUDE.md forbids any
engine code that knows about Eru, the Valar, Middle-earth, or any other named legendarium —
Engine Philosophy is unconditional on this point. The correct framing, and the one every
section below is held to, is:

> Give the engine the same kind of generic, pack-configurable primitive for *mythic* history
> that it already has for *political* history (Organization) and *causal* history (Event) —
> so a fantasy pack can build something Tolkien-deep, a sci-fi pack can build something
> Herbert-deep, and a pack that wants none of it pays zero cost.

## 2. The test every proposal below must pass

Three checks, derived from CLAUDE.md's Decision Filter and Prime Movers' growth law,
applied *before* any Decision-Filter check per-item:

1. **Generic, not lore.** No named deity, no hardcoded moral law ("corruption cannot
   create"), no fixed pantheon size or shape. Only a *mechanism* a pack may populate,
   partially populate, or leave entirely empty.
2. **Producer/consumer before primitive.** Per Prime Movers §"How the engine grows": the
   first question for every item below is *"is this actually just a new producer or
   consumer of Belief/Mark/Event/Intent?"* — not "what new Construct do I add?" Most of
   the sections below answer that question "yes, it's a producer" and are cheaper than
   they look at first read. Exactly one (§4.3, Oaths) fails that test honestly.
3. **Legible on arrival.** Per CLAUDE.md's Legibility pillar and Prime Movers' causal
   chain, a mythic effect must be traceable stage-by-stage like anything else. "The
   sword is cursed" must resolve to a Belief with evidence, an Event with a cause, or
   both — never an invisible flag that changes outcomes with no inspectable reason.

## 3. What turns out to be already solved

Two of the sharpest points in the critique are not gaps in the engine at all — they are
gaps in *content*, which is exactly where CLAUDE.md says they belong.

- **Differing metaphysical rules per species** (Elves immortal and reincarnating, Men
  mortal by design, Ents awakened trees) is already expressible through Species-as-data
  (`11-simulation-ontology.md` — capability-first classification, "what capabilities
  does it need?"). A pack can already give one Species `lifespan: unbounded` and another
  `lifespan: ~80 years`, and nothing here requires new engine machinery for that. The one
  real gap is narrow: there is no field today for *what happens to identity after death*
  (reincarnates / leaves the world / binds to an Object / simply ends). That is a small,
  additive Species field, not a subsystem — see §4.4 for the one place it has engine
  consequences (a deity that can reincarnate is still just an Actor with an unusual
  `afterlifeDisposition`).
- **Myth mutation** (a death → local legend → institutional canon → disputed scripture)
  is not a new subsystem either. It is the Belief/Mark substrate's own still-open fork —
  `17-epistemics-adr.md` §9.6, "what mutates when a testimony is retold," explicitly
  deferred pending a producer that needed it. §4.1 below is that producer.

## 4. Proposed modules, in priority order

Each section states the mechanism, which existing primitive it extends (per §2 rule 2),
and a Decision-Filter check. Priority is impact-per-architectural-cost, same method as
`history-generation-gaps`' own ranking.

### 4.1 Legend Drift — closes Epistemics §9.6 (HIGHEST priority, cheapest)

**Mechanism.** A new Belief *producer*, `retell(world, teller, hearer, subject, assertion)`,
used when a Testimony crosses a pack-configured threshold of hops or years-since-origin. Unlike
ordinary testimony (which only attenuates `sourceTrust`/`observationConfidence`), a retelling
past the threshold may also mutate the **assertion** itself, drawn from a pack-owned mutation
table keyed by assertion kind (`dead` → {`slain in battle`, `taken by the sea`, `cursed`, …}).
The draw is a pure hash of `(sourceEvent, tellerChainId)` — never `world.rng` — so distorted
history is exactly as reproducible as clean history (same discipline as venue selection,
`24-local-maps.md` §8 law 2).

**Consumer.** Chronicle/annals rendering for a culture reads that culture's *currently held*
belief about an event, not the objective Event — so two cultures' oral histories of one war
genuinely diverge, and a scholar-Actor consulting a document retrieves the version their
source drifted to, with its full evidence chain still inspectable (a legend can be traced
back to the exact retelling where it changed, per §2 rule 3).

**Decision-filter check.** *(1)* Improves the simulation — legend formation is a real
historical process. *(2)* Generic — the mutation table and threshold are pack data; the
engine knows only "retellings may distort past a threshold." *(3)* Data-driven. *(4)*
Emergent — which stories drift, and how, follows from who told whom, not authored content.
*(5)* Legible — the drift is a producer on the same evidence stack as everything else;
nothing is hidden. *(6)* No special cases — it is Testimony's existing mechanism with one
new draw. *(7)* Five years — this is the mechanism a "the bards disagree about what really
happened" feature needs regardless of genre.

### 4.2 Objects as Historical Agents — already `history-generation-gaps` priority #1

**Mechanism.** Object already exists as a full ontology tier (`11 §Object`) with History,
Ownership, and Reputation. What is missing is narrow: (a) a `thematicTag` field (pack data:
"corrupting," "oath-bound," "kingmaking") that other systems can read when weighing an
Actor's ambitions toward the Object — not a hardcoded effect, just a label a pack's
Ambition/Decision content can key off; (b) **claims about an Object are Beliefs**, not a
new mechanic — "this ring is cursed" is exactly the same Belief shape as "the king is dead,"
with `subject` pointing at the Object (already permitted — `17 §4`, a Belief's subject is
any addressable id). A false rumor about a blade's power spreads and drifts exactly like
any other belief, §4.1 included.

**Revised — artifact-lite agency (v1.1).** The review's sharpest correction: a `thematicTag`
makes an Object *reputationally* significant, but Tolkien's iconic objects **pursue**
history — the Ring abandons Gollum, the Silmarils provoke wars, a sword whispers to its
bearer. That is not reputation; it is Agency, and the ontology already has the exact seam
for it: `11-simulation-ontology.md` §Dual-Role Entities, **Actor + Object**: *"A golem
assigned goals, memory, and the ability to form new intentions is an Actor — regardless of
what it is made of. The pack decides which category applies. The engine does not assume."*
An artifact that acts is therefore not a new primitive — it is an Object the pack has
additionally given a **narrow, bounded Agency profile**: a small, pack-defined Intent
vocabulary (`seek-a-worthier-bearer`, `resist-destruction`, `draw-the-covetous`) resolved
through the same Intent Resolver as any Actor's, just with a deliberately tiny menu. This
is the same discipline as a deity's bounded perception (§4.4): give the entity real Agency,
but scope it narrowly and explicitly rather than letting "it's magic" become a backdoor for
unbounded behavior. **The engine change required is zero** — this is a content pattern
(a pack populating Agency on select Objects), not new machinery. What *is* worth adding is
the `thematicTag` field from v1.0, since it is what the artifact's own narrow Ambitions and
other Actors' Ambitions toward it both key off — the tag and the agency are complementary,
not alternatives.

**Decision-filter check.** *(1)* Directly improves the simulation — this is the single
highest-leverage gap the earlier analysis found, and artifact-lite agency is what makes an
object a historical *agent* rather than merely a historical *record*. *(2)* Generic — Object
and Agency already are; the tag vocabulary and the artifact's Intent menu are pack data.
*(3)* Data-driven. *(4)* Emergent — factions competing for a tagged Object, and the object's
own narrow pursuit of a bearer, are both ordinary Intent/Ambition consequences, not scripted.
*(5)* Legible — an Object's biography is already its History; an artifact's Intents resolve
through the same inspectable Resolver as any Actor's. *(6)* No special cases — reuses Object,
Agency, Belief, Ambition wholesale; the dual-role guidance already anticipated exactly this.
*(7)* Five years — this is the mechanism every "the ring/crown/relic that shapes an age"
story needs, in any genre, and it costs nothing until a pack actually populates it.

### 4.3 Oaths, Curses, Prophecy — the one genuinely new primitive

**Why this one is different.** Every other section in this document resolves to "this is
a producer or consumer of an existing primitive." This one does not, and honesty about that
(per §2 rule 2) is the point: a Binding constrains *future* action across time and often
across generations — no existing Mark reduces to that shape.

**Mechanism, kept as narrow as the Belief v1 slice (`17` §12) was.** A `Binding`: a
`{ subject, constraint, carriers[], sinceTick, expiresTick? }` held by one or more Actors
(and inheritable — a carrier list that can include an Actor's descendants or an
Organization's successors, mirroring how Object ownership already transfers through
inheritance). A `constraint` is a pure predicate over a candidate Intent — "never forsake
the pursuit of X," "never raise a hand against Y's line" — checked at Reasoning, the same
stage Beliefs already bias (Prime Movers §3: `Belief → Reasoning`, never `Belief → Reality`).
**A Binding never fires an Action itself** — it only weights or forbids candidate Intents,
exactly as a Belief does. This keeps it inside the existing causal chain rather than
inventing a second one.

**Carrier breadth (revised, v1.1).** The review correctly points out that Fëanor's Oath and
the Curse of the Dead Men bind more than one Actor's own future self — they bind a
bloodline, a people, a place. `carriers[]` is therefore typed to hold *any addressable id*,
the same permissiveness a Belief's `subject` already has (`17 §4`: "any addressable id —
Actor, Location, Object, Organization, or Event"): an Actor and their unborn descendants
(resolved at birth by checking ancestry against the Binding, mirroring how Species traits
already inherit), an Organization and its successors (mirroring how Object ownership and
Organization history already survive a schism/merge), or a Location (a curse *on a place* —
every Actor who comes to dwell there inherits the constraint for as long as they remain, no
different in shape from a culture's values applying to whoever lives there). No new carrier
mechanism per type — each already has an inheritance/succession/occupancy rule the Binding
piggybacks on, exactly as the growth law prefers.

**Prophecy is a Belief about a future Event**, unresolved (`stance: unknown` is the honest
starting state — nothing is foreknown) until an Event matching the assertion is emitted, at
which point the historian/UI layer can mark it "fulfilled" — precisely the
correspondence-on-demand mechanism Epistemics already uses for past claims (`17 §5`), just
pointed forward instead of backward.

**Scope fence, following the 1A pattern:** v1 proves one thing only — that a Binding can
outlive the Actor who swore it (a descendant inherits the constraint) and measurably bias
their Reasoning. Contested/overlapping Bindings (three heirs, one oath, conflicting claims)
are a later increment, not v1.

**Decision-filter check.** *(1)* Improves the simulation — unlocks the category of history
where a single sworn act ripples for centuries. *(2)* Generic — constraint predicates and
carrier rules are pack data; no oath is hardcoded. *(3)* Data-driven. *(4)* Emergent —
which Bindings form and collide is a consequence of Ambition/Decision content, not scripted
plot. *(5)* Legible — a Binding's `cause` is inspectable exactly like a Belief's evidence
stack; "why did she refuse the throne?" resolves to "bound by an oath sworn by her
great-grandfather." *(6)* Special cases — this is the one item that **does** add a new
Construct, which is exactly why it must be prototyped smallest and frozen fastest (Prime
Movers' growth law) rather than grown feature-first. *(7)* Five years — oath/curse/prophecy
is high-value across genres (a sci-fi pack's AI directive, a wuxia pack's blood vow) and
should be built once, generically, rather than per-pack.

### 4.4 Divine / Supernatural Actors as historical agents — mostly already solvable

**Mechanism.** A deity that *acts* in history is simply an Actor (or an Organization, for a
pantheon acting collectively) with an unusual capability configuration: no Needs, an
`afterlifeDisposition` that never ends active simulation, and — the one piece of actual
design work — a `revelation` producer, structurally identical to `tellBelief`, that lets a
deity seed Evidence directly into a mortal's belief stack. **Critically, revelation carries
`sourceTrust`/`observationConfidence` like any other testimony — there is no privileged
"divine truth" channel.** A false prophet and a true god look mechanically identical to a
mortal's evidence stack; only the historian, reading the objective Event log, can later say
which one corresponded to reality. This is not a limitation to work around — it is
CLAUDE.md's "every character is equal" pillar applied one level up, and it is what keeps a
deity from becoming a hardcoded oracle.

**The one open design question:** a deity's *perception* must still be bounded (Prime
Movers/Epistemics both forbid omniscience as a backdoor) — a pack must scope what a deity
can witness (e.g., "sees what its faithful witness and report," itself ordinary Testimony
flowing upward through the same funnel). No new perception mechanism; the constraint is a
modeling discipline for the pack to respect, worth stating explicitly here so it isn't
quietly violated later.

**Decision-filter check.** *(1)* Improves the simulation — unlocks "the gods intervened" as
a real, traceable historical category instead of an absent one. *(2)* Generic — nothing
about a deity is engine-hardcoded; a sci-fi pack's "ascended AI" or a pack with no deities
at all cost nothing. *(3)* Data-driven — deity count, domain, and perception scope are all
pack config. *(4)* Emergent — a deity's interventions are Ambition-driven Intents like any
Actor's. *(5)* Legible — revelation is inspectable Testimony; no hidden channel. *(6)* No
special cases — reuses Actor, Belief, Testimony wholesale; the "equal" pillar is the reason
this needs no new machinery. *(7)* Five years — this is the sharpest CLAUDE.md tension in
the whole document, and resolving it as "an Actor with unusual capabilities" rather than a
privileged code path is what keeps it defensible five years out.

### 4.5 Corruption — a derivation relation, PLUS a contagion (revised v1.1) — MEDIUM priority

**Mechanism (origin — unchanged from v1.0).** A `derivedFrom` field on Species (pack data):
a derived Species inherits a parent Species' baseline and applies pack-defined trait deltas
— the same base+modifier grammar Warsim's `RaceSuffix` already demonstrated at scale
(`01-warsim-analysis.md` §1.3 pattern 3, generalized). No new entity, no engine-enforced
morality: the engine offers the relation; a pack that wants "corruption never originates,
only twists" simply never gives a corrupted Species a null `derivedFrom` after the first
age. The engine does not adjudicate whether that's true — it only makes the relation
expressible.

**Revised — corruption as a contagion (v1.1).** The review's correction: origin-only
derivation covers *how a corrupted species came to exist*, but not *corruption as an
ongoing metaphysical process* — ideas, places, objects, and institutions that corrupt
what comes near them, that can deepen or be healed. This does not need a new subsystem:
`13-simulation-rules.md`'s Systems table already has the exact shape, in the **Disease**
system ("pathogen spread, morbidity, epidemic events," propagating over a contact/proximity
graph and writing to a component). Corruption is that same propagation mechanism, aimed at
a different component and a wider set of carriers:

```
Disease    → spreads over contact graph → writes Health           (Actor only)
Corruption → spreads over contact graph → writes a `taint` value  (Actor · Organization · Location · Object)
```

Concretely: a `taint` field (pack-scoped 0..1, or a small enum) on any entity with Identity;
a spread pass (same cadence tier as Disease) that reads proximity/relationship/ownership
edges already in the simulation (an Actor near a tainted Object, an Organization that
absorbs a corrupted institution, a Location downstream of a corrupted river) and raises
neighboring `taint`; and a healing path symmetric to recovery (a `taint` that decays absent
reinforcement, or is actively reduced by a pack-defined ritual/Intent). **No new spread
mechanism — this generalizes Disease's existing propagation graph to be entity-type-agnostic
and component-target-configurable**, which is a small, honest engine change (Disease today
likely assumes an Actor target) rather than a new Corruption engine.

**Decision-filter check.** *(1)* Improves cultural/species depth cheaply, and turns
corruption from a one-time fact into a genuine ongoing historical process. *(2)* Generic —
purely a data relation plus a generalized propagation graph; a pack with no corruption
mechanic pays nothing extra beyond what Disease already costs. *(3)* Data-driven, directly.
*(4)* Emergent — which entities corrupt, spread to, or recover from taint follows the same
proximity/ownership graph as trade and disease already do, not scripted. *(5)* Legible — a
`taint` value's cause is the same kind of traceable spread-event chain Disease already
provides ("infected by contact with X on tick T"). *(6)* No special cases — reuses the
Species-derivation relation for origin and the Disease propagation graph for spread; the
only new work is making that graph's target/component configurable. *(7)* Five years — a
generically useful contagion primitive (also models "ideological radicalization," "genetic
drift," "cultural assimilation") well beyond the corruption use case alone.

### 4.6 Decline / Ages — revised v1.1: Rules change, not a modifier table — MEDIUM priority

**The review's correction, and why it's right.** v1.0 proposed "ceiling modifiers" (a
`MagicMultiplier: 0.85`-shaped table) — exactly the mechanical, continuous-decay framing
the review objected to: Tolkien's decline is existential (magic fades because *what reality
permits* changes), not a stat debuff. The fix is not a new mechanism — it is to notice that
`13-simulation-rules.md` already has the primitive this needs and v1.0 reached for the wrong
one. **Rules are the physics of a universe** (§Rules: "define what is possible"), the
Supernatural/Technological Rules category already includes exactly this kind of gate
(`magic: enabled/rarity`, `resurrection: possible/disabled`), and **invariant 17** already
states the missing mechanism verbatim: *"Rules cannot be changed during a running
simulation. Rule changes require a world reset or **an explicit epoch-transition event**."*

**Mechanism (revised).** An `Age` is a world-scale epoch-transition Event (invariant 17's
own mechanism, not a new one) whose effect is to **replace the active Supernatural/
Technological Rules**, not multiply a ceiling: magic goes from `enabled, rarity: common` to
`enabled, rarity: forbidden` to `disabled`; resurrection goes from `possible` to `disabled`.
Because Rules are enforced in the Intent Resolver (§Rule Enforcement) *before* an intent is
even attempted, a post-decline Actor doesn't attempt weaker magic and fail more — a
magic-shaped Intent is no longer legal at all, exactly the "what reality permits" framing
the review asked for. **No new Construct, no modifier table** — this is invariant 17 used
for the purpose it was already written for, applied at world scale via the pack's own Age
sequence (still pack data: era names, and which Rule fields each epoch-transition rewrites).

**Wonder (new in v1.1) — the Director-facing half of Decline.** The review's separate point
about "the frequency of impossible events" is the Director's side of the same coin: bucket
Director incidents by a pack-defined **wonder tier** (mundane / remarkable / legendary /
divine — a pack picks its own vocabulary and tier count), and let each Age's epoch-transition
Event also gate *which tiers are available* to the Director's incident draw (a First-Age
world can roll a divine-tier incident; a Fourth-Age world's draw is truncated to
mundane/remarkable). This is a **selection-space change**, not an outcome bias — the
Director still draws from its existing seeded stream; the Age only changes the menu it draws
from, the same way Rules change the Resolver's menu of legal Intents. This is explicitly
*not* Providence (§4.7): nothing here weights an outcome toward a theme, it only changes what
categories of incident are legal in this Age, symmetrically with how Rules changed what
categories of Intent are legal.

**Decision-filter check.** *(1)* Improves long-horizon legibility with more fidelity than
v1.0 — "why is magic gone" now answers "the Rules changed at the Third Age's end," not "a
number got smaller." *(2)* Generic — Rule fields, era boundaries, and wonder-tier vocabulary
are all pack data; a pack with one unchanging age (and one wonder tier) pays nothing. *(3)*
Data-driven. *(4)* Emergent — which age a world is in still results from simulated epoch
events, not a script. *(5)* Legible — a Rule change is already inspectable (it's a Rule);
the Director's tier gate is a plain, inspectable table. *(6)* No special cases — reuses
invariant 17 and the existing Director draw verbatim; nothing new is added to either. *(7)*
Five years — this is a strictly better foundation than a modifier table, since it composes
with anything else that already reads Rules (which is everything the Intent Resolver
touches) instead of requiring every consumer to remember to apply a new multiplier. Pairs
naturally with `28-settlement-legibility.md`'s Fortunes; sequence after that ships.

### 4.7 Creation Paradigm (promoted, v1.1) / Providence (still rejected) — split priority

**Cosmology, revised — the review's largest correction, and it's right.** v1.0 dismissed
cosmology as "pure pack lore," reasoning that a creation-event pre-history is content a pack
can already write with zero engine change. The review's rebuttal is sharper: a creation
paradigm isn't a story, it's **which Rules are load-bearing** — if reality was *sung* into
being, music should have genuine causal weight somewhere a pack can plug into; if it was
*dreamed*, dreams should be able to produce real Evidence. That is not lore, and it turns
out the engine already has exactly the tier this belongs in: `13-simulation-rules.md`'s
**Supernatural/Technological Rules** category, sitting right beside `magic`, `warpTravel`,
and `resurrection`. **Promoted mechanism:** add `creationParadigm` as a pack-selected Rules
value (an open enum — `sung`, `forged`, `dreamed`, `mathematical`, `sacrificial`, or a
pack's own), which other Rules and systems may key off exactly as they already key off
`magic.enabled`:

```
rules:
  creationParadigm: "sung"
  magic:
    enabled: true
    systemId: "song-magic"        # a pack's Magic system, gated by creationParadigm
  epistemics:
    inferenceSources: ["dream"]   # only meaningful if creationParadigm == "dreamed"
```

This is not a new Construct — it is one more Rules field, read by whichever systems a pack
chooses to gate on it (its own Magic module, or — per §4.9 — treating dreams/song as a
legitimate `inference`/`document` Evidence producer). The engine adds nothing but the field
and the convention; a pack that declares no `creationParadigm` behaves exactly as before.
**This is genuinely low-cost now that it is correctly placed** — the earlier "low priority"
verdict was about a *content* task; as a *Rules field*, it belongs in the same batch as
§4.6's Rules-based Decline, since both are "one Rules field, read by whatever a pack wires
to it."

**Providence — still rejected, and this review sharpens why.** Biasing *outcomes* toward
thematic resonance remains the one item in this document that cuts against "avoid scripted
events" and "deterministic simulation over randomness" (Prime Movers: *reality is simulated,
never authored*). The review's own "Myth-Aware Director" suggestion (§4.11 below) is
deliberately **not** this: it biases which existing legendary threads become *candidates*
for a new incident, never which outcome a resolved incident produces. That distinction is
the whole reason Providence stays rejected while §4.11 is accepted below — selection bias
without outcome bias preserves determinism-of-consequence; outcome bias does not.
**Recommendation unchanged: do not build a general providence primitive.** A pack-scoped
weighting table, consumed only by that pack's own systems and never an engine default,
remains the only acceptable shape, and only once a real pack asks for it.

### 4.8 Sacred Geography (new, v1.1)

**Mechanism.** The review's question — "why is this mountain holy, why do pilgrims travel
there" — turns out to already be answerable with existing capabilities, once named
explicitly. Location already carries Reputation and History (`11 §Location`); Object already
has a "historically significant" threshold that promotes it into Chronicles/Annals/Legends
(`11 §Object`). **The gap is that the same threshold-and-promotion pattern was never stated
for Location.** Fixing that is the whole mechanism: a Location whose History crosses the
pack's significance threshold (a battle, a miracle, a founder's tomb, per §4.1's Legend
Drift feeding its own reputation) becomes a **Legendary Location**, exactly as an Object
does. The one new content piece is a **Pilgrimage** Ambition template — an Actor's existing
Ambition system (`ambition.ts`) gains a candidate ambition, "visit the [Legendary Location],"
weighted by the Actor's culture/values (a devout Actor weights a shrine higher; per §4.9 a
scholar might weight a site tied to a disputed etymology).

**Decision-filter check.** *(1)* Improves legibility of why places matter, cheaply. *(2)*
Generic — significance thresholds and pilgrimage weighting are pack data; the mechanism is
identical to Object's existing pattern. *(3)* Data-driven. *(4)* Emergent — which places
become sacred falls out of which events actually happened there, never authored. *(5)*
Legible — a Location's "why is this holy" answers with the same History read as any other
entity. *(6)* No special cases — reuses Location's existing capabilities and Object's
existing threshold pattern; the only true addition is one Ambition template. *(7)* Five
years — the mechanism generalizes past "sacred" to any culturally-weighted place (a
battlefield memorial, a haunted ruin, a disputed border shrine).

### 4.9 Language as Archaeology (new, v1.1)

**Mechanism.** The review is right that procedural philology today only *names* things; it
does not yet let a name become *evidence*. The fix needs no new machinery: `17 §12` already
lists `document` and `inference` as future Evidence producers, deferred past Belief v1
pending a concrete use. Philological inference is exactly that use: a scholar-Actor's
research Intent compares a place's current name against the historical naming-system record
(already generated and, per procedural philology's shipped work, culturally attributable) —
a mismatch (a river bearing an older culture's root in territory a newer culture now holds)
becomes Evidence supporting a migration-history Belief, through the same `acquireEvidence`
funnel witness and testimony already use. Nothing new is invented; this closes an
already-anticipated producer with its first real content.

**Decision-filter check.** *(1)* Improves depth of the philology system already shipped, at
low cost. *(2)* Generic — the mismatch-detection rule and what counts as "older" naming
layers are pack data. *(3)* Data-driven. *(4)* Emergent — which mismatches get discovered,
by whom, follows from Ambition-driven research Intents, not scripted reveals. *(5)* Legible
— the resulting Belief carries its evidence chain exactly like any other. *(6)* No special
cases — this is `inference`, the producer `17` already named and deferred. *(7)* Five years
— a natural home for "how do historians know what they know" in any genre with a naming
system.

### 4.10 The Mythic Feedback Loop (new, v1.1 — the review's central point)

**Why this is the biggest addition.** The review's single sharpest observation: "the
proposal models mythology as information, but Tolkien often models mythology as an active
force in history." §4.1 (Legend Drift) makes stories change. It does not, on its own, make
stories change *civilizations*. Closing that gap does not require a new primitive — Prime
Movers' growth law again answers the question correctly: **this is three new consumers of
Belief, wired into three reducers/selectors that already exist but don't yet read it.**

1. **Culture drift consumes legend.** `worldviewOf` already reduces member *values* to a
   culture's collective worldview. Give it one more weighted input: a legendary Belief held
   broadly enough (crossing the same corroboration threshold that already promotes an Object
   or Location to historically-significant, §4.2/§4.8) nudges the *values* of actors who hold
   it — a culture that widely believes "the shepherd king was chosen by fate" drifts toward
   valuing humility and providence in its own worldview reducer, no differently in shape from
   how a precept already emits a self-thought (`23-precepts-belief-module.md`).
2. **Ambition selection consumes legend.** The existing Ambition system already weights
   candidates by culture and personality; add "resembles a legendary exemplar" as one more
   weighting input — an Actor whose values/temperament resemble a legendary figure's
   (matched against that figure's recorded values, since the figure was once a real simulated
   Actor) gains a weighted **emulation** ambition. This is what produces "future heroes model
   themselves on this one" without scripting it: it is the existing selection function reading
   one more legitimate input.
3. **Organization founding consumes legend.** A legendary Belief crossing a broad-enough
   threshold becomes an eligible *founding condition* for a new Organization (a devotional
   order, a knightly fellowship, a scholarly college) — reusing whichever founding mechanism
   already gates new Organizations, generalized to accept "belief-triggered" as one more
   trigger alongside whatever already exists, never a bespoke "cult system."

**None of the three needs a new Construct.** Each is an existing reducer/selector gaining one
more legitimate input, which is precisely the discipline Prime Movers prescribes ("write the
reducer, don't add the field" — here, extend the reducer's inputs, don't invent a parallel
mythology engine). The loop this closes is the review's own diagram: `Event → Belief →
Retelling → Culture/Ambition/Organization → new Ambitions and Intents → new Events` — myth
now feeds back into the causal chain it came from, at the Reasoning stage, exactly where
Prime Movers says subjective state is allowed to act (never at Reality directly).

**Decision-filter check.** *(1)* This is the item that most improves the simulation —
it is the actual missing feedback loop the whole document was reaching for. *(2)* Generic
— corroboration thresholds, exemplar-matching, and founding conditions are all pack data;
the three consumers are generic reducer/selector extensions. *(3)* Data-driven. *(4)*
Emergent — nothing here scripts a specific culture shift, ambition, or order; each is a
weighted consequence of whatever the world actually produced. *(5)* Legible — a culture's
drift, an actor's emulation ambition, and an order's founding all trace back to the specific
legendary Belief that fed them, through the same reasons-extractor pattern every reducer
already provides. *(6)* No special cases — three existing systems (`worldviewOf`, Ambition
selection, Organization founding) each gain one new input; none gains a parallel path. *(7)*
Five years — this is the mechanism that turns "stories change" into "stories change
civilizations," in any genre, which is the review's whole point.

### 4.11 Director Myth-Awareness (new, v1.1 — selection bias, not outcome bias)

**Mechanism.** The review's "Myth-Aware Director" is accepted, with the boundary stated
explicitly so it cannot slide into Providence (§4.7): the Director may weight which
**existing** legendary threads (an unclaimed prophecy, a wandering cursed artifact, a house
under a Binding) are more likely to be drawn as the **subject** of a new incident — it never
weights what that incident's **outcome** will be. Concretely: the Director's existing
interest-scored incident draw (already seeded, already deterministic) gains legendary
entities as higher-weight candidates in the *subject pool* it draws from; resolution of
whatever incident results proceeds through the completely ordinary, unbiased mechanics every
other incident uses. "The simulation notices the cursed sword exists, so more people seek
it" is a selection-space fact (more Ambitions get *offered* the sword as a target); what
happens when they reach it is resolved with no thumb on the scale at all.

**Decision-filter check.** *(1)* Improves the felt density of mythic entanglement without
touching outcome fairness. *(2)* Generic — "legendary" is whatever threshold a pack already
set for §4.1/§4.2/§4.8; the Director doesn't know what a Ring is, only that this Object
crossed a significance threshold. *(3)* Data-driven — the weighting curve is pack config.
*(4)* Emergent — still a draw from real state, just a reweighted one. *(5)* Legible — an
incident's subject-selection weight is as inspectable as its existing interest score. *(6)*
No special cases — extends the Director's existing weighted draw with one more input signal;
resolution code is untouched. *(7)* Five years — the cleanest form of "the world leans
toward its own stories" that doesn't compromise determinism-of-consequence, which is exactly
why it survives where general Providence does not.

## 5. Cross-genre universality check (v1.2)

A third review pass set Tolkien aside and mentally transplanted §4.1–§4.11 into A Song of
Ice and Fire, Star Trek, Dune, Warhammer 40K, Foundation, Mass Effect, and RimWorld, asking
of each item: does it stay useful, does it express that universe's defining historical
forces, and if not, is the gap already emergent, mere content, a producer/consumer, or a
true missing primitive? The result: every §4 item holds up, several are validated by an
almost exact match already present in a shipped fictional universe, worth recording because
they are evidence, not just argument, that the abstraction level is correct:

- **Rules-based Decline (§4.6)** is validated by Dune's **Butlerian Jihad** — an
  epoch-transition event that flips one Rules field (`ai: enabled → disabled`) and reshapes
  every downstream system for ten thousand years — which is *exactly* the mechanism
  proposed, not an approximation of it. It is also validated by Mass Effect's **Reaper
  cycles**: a recurring epoch-transition (harvest) bounding repeating Ages, which argues the
  Age timeline should be modeled as a *graph* a pack can make cyclic, not only linear — worth
  a one-line addition when §4.6 is implemented.
- **The Mythic Feedback Loop (§4.10)** is validated twice, in different directions. 40K's
  **Ecclesiarchy** is an Organization literally founded centuries after the fact around a
  legendary Belief (the Emperor's godhood) — organic corroboration crossing a founding
  threshold, exactly as designed. Dune's **Bene Gesserit Missionaria Protectiva** is the
  same loop run *deliberately*: an Organization with a centuries-long Ambition to seed a
  messiah legend on many worlds. Tracing the mechanism confirms this needs no new
  primitive — an Organization repeatedly using the ordinary `tellBelief`/`retell` producers
  (§4.1) toward its own long-horizon Ambition *is* engineered myth-manufacture, with no
  special "propaganda" system required. This is a meaningful confirmation: the design
  supports both organically-emergent and deliberately-engineered mythology through the same
  producers, which is a stronger result than either alone.
- **Divine Actors (§4.4)** generalizes further than "deity": Foundation's **the Mule** (a
  mutant with reality-warping social influence but no supernatural framing at all) and
  Star Trek's **Q** both fit the same resolution — an Actor with a capability profile far
  outside the population's norm, never a privileged truth-channel. The section is better
  understood as "exceptional-capability Actors," of which "deity" is one pack's flavor text,
  not the primitive's shape.
- **Creation Paradigm (§4.7)** generalizes past cosmogony: 40K's Warp (a Rules field other
  systems — psionics, Chaos corruption, faster-than-light travel — all key off) and Dune's
  spice/prescience nexus are both "the metaphysical premise the setting's central conceit
  rests on," gating multiple other systems exactly as designed.
- **Objects/artifact-lite agency (§4.2) and Language as Archaeology (§4.9)** are real and
  correctly optional, but genuinely *lower-frequency* outside Tolkien — ASOIAF's and Dune's
  iconic objects (Valyrian steel, the spice) mostly do not pursue goals, and few universes
  narrativize etymology the way Dune and ASOIAF's toponymy do. This is not a defect: both
  are pack-scoped capabilities that cost nothing unused, and uneven uptake across genres is
  the expected shape for an optional module, not evidence the primitive is wrong.

## 6. Historical Attractors — emergent, not a missing primitive (v1.2)

The review's central open question, stated precisely: The One Ring, the Iron Throne, the
Golden Path, the Federation, Chaos, the Reapers, psychohistory, and the Archotech recur
across unrelated universes as things that continually generate ambitions, migrations,
conflicts, institutions, and myths across centuries. Is this pattern already emergent from
§4.1–§4.11, or does its recurrence across unrelated settings indicate a true missing
primitive?

**Tracing each example through the existing mechanisms, rather than arguing in the
abstract, is the only honest way to answer this** — and each one decomposes cleanly:

- **The One Ring / Iron Throne** — an Object or Object+seat with `thematicTag`, crossed
  History's significance threshold (§4.2, §4.8's Location-parallel), now a standing input
  to many Actors' Ambition selection (§4.10).
- **The Golden Path** — a very-long-duration Prophecy held as a Binding (§4.3) by an
  Organization's succession line, whose downstream Organization-founding (multiple factions
  forming in reaction to it) is §4.10's third consumer.
- **The Federation / the Reapers** — plainly an Organization (§11, already a first-class
  entity that outlives its members); the Reapers' cyclic recurrence is §4.6's epoch-transition
  applied on a repeating schedule, not a new entity kind.
- **Chaos** — decomposes into *four* existing mechanisms working together, not one missing
  one: a Creation Paradigm (§4.7, the Warp as metaphysical substrate), a Corruption contagion
  (§4.5), and multiple exceptional-capability Actors (§4.4, the Chaos Gods). Its mythic
  weight comes from composition, which is itself evidence the primitives are the right size
  — a single "Chaos primitive" would have had to duplicate all four.
- **Psychohistory** — a civilization-scale Prophecy (§4.3) that becomes the object of its
  own Mythic Feedback Loop (§4.10) once the Foundation venerates Seldon's plan as religion.
- **The Archotech** — an Actor/Organization at the far end of §4.4's exceptional-capability
  spectrum; its outsized historical reach is a question of *propagation radius* (how far an
  Ambition, Testimony, or Reputation reaches), not a new entity kind.

**Conclusion: "Historical Attractor" is not a missing primitive — it is the name for what
any sufficiently legendary Object, Location, Organization, or Binding *becomes* once the
Mythic Feedback Loop (§4.10) runs on it continuously for long enough.** It is a description
of the *steady-state behavior* of existing primitives, not a gap in them. Proposing a new
Construct for it would violate §2 rule 2 (producer/consumer before primitive) for no
capability gain — everything the examples do is already reachable.

**What genuinely is missing is legibility, not mechanism**, and the fix is a **reducer**,
not a primitive — exactly the "write the reducer, don't add the field" law already
governing collective Mark reductions (`11 §Mark`). Propose an **Attractor Strength**
reducer: a pure read over existing data — count of independent Actors/Organizations whose
current Ambitions, Beliefs, or founding conditions orient toward entity E, within a rolling
window, weighted by span and recency. It stores nothing new and mutates nothing; it only
answers, on demand, "how much of the world's ambition currently orbits this thing, and for
how long has it." This is a Legibility feature (CLAUDE.md's pillar, directly): "why does
this castle matter so much" now has a computed answer — "forty-seven ambitions across six
generations have oriented around it" — instead of the pattern being real but unnamed.

**Decision-filter check.** *(1)* Improves legibility of an already-emergent pattern, at zero
simulation cost. *(2)* Generic — reads whatever Ambition/Belief/Organization-founding data
already exists; no pack-specific concept of "attractor." *(3)* N/A — a pure reducer, no new
data. *(4)* N/A — makes emergence visible, adds none. *(5)* Legible — this *is* the
legibility fix. *(6)* No special cases — one more reducer alongside `worldviewOf`/
`orgBeliefOf`, at the same tier. *(7)* Five years — a reducer this general (it works over
Object, Location, Organization, and Binding uniformly) is exactly the shape Prime Movers'
methodology rewards.

## 7. The Law of Mythic Scarcity (v1.2, promoted to `18-prime-movers.md` same day)

The review's second question — how does the engine prevent mythic inflation, given §4 now
offers eleven ways to become significant — deserves a real answer, not pack guidance alone,
because leaving it to convention means a pack *can* (and by default probably will) over-mint
legendary status, and nothing in the engine pushes back. The fix does not need new
machinery either: it needs one existing law applied where it is currently missing.

**This law turned out not to be mythology-specific**, and has been promoted to
`18-prime-movers.md` §"Significance is derived, never stored" as an engine-wide law
alongside "how the engine grows" and Observer independence. What follows is the mythic
layer's application of that engine-wide law; treat `18` as the canonical statement and this
section as the worked example that produced it.

**The gap, found by actually auditing the codebase rather than reasoning abstractly.**
A stored "this is now significant" bit can only accumulate — nothing is ever written to
*decrease* it. Checking whether the shipped engine already has an instance of this found
one: **`engine/model.ts`'s House `prestige` is a plain stored `number`**, incremented
across several events (`figures.ts`: `+= HOUSE_FOUND`, `+= HOUSE_CONQUEST`,
`+= HOUSE_ASCEND`, `+= HOUSE_REIGN`) with **no decay path anywhere in the codebase** —
exactly the anti-pattern this law forbids, shipped today, and precisely the "dynastic
prestige" example the review named. (`11-simulation-ontology.md` §Object's own
"historically significant" language was checked too, but Object isn't implemented in the
PoC yet — so that phrasing is a documentation risk worth wording carefully before
implementation, not a live bug; it has been tightened accordingly.) Right beside the real
bug sits a correct worked example: `sim.ts`'s "notable residents" selection recomputes
fresh from live `standingOf()` (a Mark reducer) every time and stores nothing — the pattern
prestige should converge toward. Fixing `prestige` is deliberately **not** done inline here
— it changes game balance (which Houses read as prestigious), which is a product decision
needing its own scoped task, not a documentation-pass drive-by; it has been spawned
separately (see below) rather than silently patched.

**The law.** Every other form of subjectivity in the engine already avoids this exact trap
— a Belief's stance, an opinion's sentiment, a standing's reputation are all *computed on
demand from a decaying stack*, never stored conclusions (`11 §Mark`, `17` throughout). This
document adopts the same discipline for mythic status:

> ## Legendary, sacred, or attractor status is always a reducer over a decaying stack — never a stored flag.

Concretely: an entity's "legendary" tier is computed from its currently-*active* significant
Marks/Records — recent corroborating Beliefs, recent Ambitions oriented toward it, recent
retellings — exactly as `computeStanding` or Attractor Strength (§6) already are. This
delivers both halves of the review's principle as one mechanism, reusing infrastructure that
already exists everywhere else in the engine:

- **Hard to attain (rarity)** — the threshold requires *multiple independent, corroborating*
  sources accumulated over time (the same evidence-accumulation shape as Belief, `17 §9.2`),
  not one excited witness or one dramatic event. A single retelling does not mint a legend.
- **Easy to lose (persistence, not permanence)** — with no reinforcement (no new Ambitions
  forming, no new corroborating Belief, no new retellings), the underlying Marks expire on
  schedule and the computed tier falls, exactly as an unreinforced opinion or belief already
  decays. A once-legendary sword that no one has sought, told of, or fought over in three
  generations quietly stops reading as legendary — which is itself a legible, traceable
  historical fact ("the old songs about it stopped being sung"), not a silent state change.

**Why this must be an engine law, not pack guidance.** Every other Mark-adjacent law in the
engine (`11 §Mark`: "derived never stored," "reducers read, producers write") is phrased as
a prohibition precisely because leaving it to convention has already been shown, in this
engine's own history, to rot into special cases if left optional (the Phase 2C intent-leak
that motivated invariant 8 is the cautionary precedent). Mythic scarcity gets the same
treatment: stating it as a law, not a suggestion, is what keeps eleven ways to become
significant from becoming eleven ways to inflate significance.

**Decision-filter check.** *(1)* Directly protects the value of everything else in this
document — inflated legendary status is diluted legendary status. *(2)* Generic — the law
constrains *how* significance is computed, never *what* counts as significant, which stays
pack data. *(3)* N/A — a computation discipline, not new data. *(4)* Emergent — which
entities hold legendary status at any moment is a live consequence of ongoing reinforcement,
never a permanent grant. *(5)* Legible — decay of legendary status is exactly as traceable
as decay of any other Mark. *(6)* No special cases — this is the *removal* of a special
case (a stored flag) in favor of the pattern every other subjective system already follows.
*(7)* Five years — the same law that already keeps Belief/Reputation/Opinion honest as the
engine scales; extending it here is the cheapest possible fix for the single biggest risk
this document introduces.

## 8. What this document explicitly does not propose

No engine-level deity roster, no hardcoded moral law ("evil cannot create" as an enforced
rule rather than an available relation), no default providence bias (outcome-weighting —
§4.11's selection-weighting is explicitly not this), no per-species metaphysics baked into
the engine rather than Species/Rules data, and — per §7 — no permanent/stored mythic status
of any kind. Every item in §4 is either a pack-configurable relation, an existing
primitive's new producer/consumer, a new input to an existing reducer/selector (§4.10), a
pure legibility reducer (§6), or — in exactly one case (§4.3) — a narrowly-scoped new
Construct, prototyped to the smallest slice that proves it before anything grows outward
from it.

## 9. Sequencing recommendation

By leverage-per-architectural-cost, cheapest and most-requested first. Revised in v1.1:
Creation Paradigm and Rules-based Decline moved up (both turned out to be "one Rules field,"
not new machinery); the Mythic Feedback Loop is placed right after Legend Drift and Objects
since it is what makes both of them matter beyond information. Revised again in v1.2: the
**Law of Mythic Scarcity retrofit moves to position 1**, ahead of everything it protects —
every subsequent item mints some form of significance, so the decay discipline should exist
before there is anything for it to guard. The **Attractor Strength reducer** is sequenced
right after the Mythic Feedback Loop, since it is a pure legibility read over exactly what
that loop produces.

1. **Law of Mythic Scarcity retrofit** (§7, now `18-prime-movers.md`) — fix the real,
   confirmed violation, `House.prestige` (`engine/model.ts`/`figures.ts` — a stored,
   only-incrementing number, no decay path), before any of §4.1/§4.2/§4.8/§4.10 start
   minting new significance on top of the same unfixed pattern. Already spawned as its own
   task rather than folded into this sequencing, since it changes game balance. `11 §Object`
   needed only a wording fix (Object isn't implemented yet), not a code retrofit.
2. **Legend Drift** (§4.1) — closes an already-open fork (`17` §9.6), reuses the full
   Belief substrate, no new Construct.
3. **Objects as Historical Agents, including artifact-lite agency** (§4.2) — already ranked
   #1 in `history-generation-gaps`; Object, Belief, and the dual-role Actor+Object guidance
   already do the work.
4. **The Mythic Feedback Loop** (§4.10) — three existing reducers/selectors (`worldviewOf`,
   Ambition selection, Organization founding) each gain one new input; this is what turns
   §4.1 and §4.2 from "stories change" into "stories change civilizations." Validated by
   both 40K's Ecclesiarchy (organic) and Dune's Bene Gesserit (engineered) — see §5.
5. **Attractor Strength reducer** (§6) — a pure legibility read over what §4.10 produces;
   ship once the feedback loop has real data to read.
6. **Creation Paradigm** (§4.7, promoted) and **Rules-based Decline** (§4.6, revised) — group
   these together; both are "add one Rules field, let invariant 17's epoch-transition drive
   it," the cheapest architectural shape in the whole document once correctly placed.
   Cross-genre validation: Dune's Butlerian Jihad and Mass Effect's Reaper cycles (§5).
7. **Oaths / Curses / Prophecy** (§4.3, carriers broadened) — the one real new primitive;
   prototype smallest, freeze fastest, per the growth law.
8. **Divine Actors** (§4.4) — confirm the ontology already permits it; ship the
   `revelation` producer once Belief/Testimony's equal-footing discipline is settled by §4.3.
   Reframed by §5 as "exceptional-capability Actors" generally, not only deities.
9. **Sacred Geography** (§4.8) and **Language as Archaeology** (§4.9) — both close an
   already-anticipated gap (Location's unstated significance threshold; Epistemics' deferred
   `inference` producer) with no new mechanism; low cost, do opportunistically. Uptake will
   vary sharply by pack (§5) — that unevenness is expected, not a warning sign.
10. **Corruption as contagion** (§4.5, revised) — needs the Disease propagation graph
    generalized to be entity/component-agnostic; slightly more engine work than the above.
11. **Director Myth-Awareness** (§4.11) — sequence last; it is additive polish on top of an
    already-legendary-tagged world (§4.1/§4.2/§4.8), and gains little before those exist.
12. **Providence** (§4.7) — still not recommended as a general primitive.

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-12 | Initial proposal. Reconciles a third-party Tolkien-fidelity critique with CLAUDE.md's universe-neutrality mandate: every item reframed as an optional, pack-configurable module rather than engine lore. Identifies that differing species metaphysics and myth mutation are largely already solvable (Species-as-data, Belief distortion fork `17 §9.6`); proposes Legend Drift, Objects as Historical Agents, Oaths/Curses/Prophecy (the one genuine new primitive), Divine Actors (resolved as capability-configured Actors, no privileged code path), Corruption (a Species derivation relation), Decline/Ages (paired with Fortunes), and explicitly recommends against building a general Providence primitive. |
| 1.1 | 2026-07-12 | Second-pass review response. Core critique: several v1.0 items modeled *mythology as information* where Tolkien's mythology often acts as *a force in history*. Revised §4.2 to give artifacts narrow, bounded Agency (the dual-role Actor+Object seam already in `11`), not just a reputational tag. Revised §4.5 to generalize Corruption from a one-time Species-derivation fact into an ongoing contagion, reusing Disease's propagation graph generalized to be entity/component-agnostic. Revised §4.6 to replace the rejected "modifier table" framing with Rules-tier change via invariant 17's epoch-transition mechanism (Decline changes *what reality permits*, not a multiplier), and added **Wonder** as the Director's tier-gated incident-selection half of the same idea. Promoted **Creation Paradigm** (§4.7) from dismissed lore to a Supernatural/Technological Rules field, while keeping Providence rejected and sharpening why (selection-bias vs. outcome-bias) against the new §4.11. Broadened Oath/Binding carriers (§4.3) beyond a single Actor to bloodlines, Organizations, and Locations, each via that entity type's existing inheritance/succession/occupancy rule. Added **Sacred Geography** (§4.8, Location's unstated significance threshold), **Language as Archaeology** (§4.9, closes Epistemics' deferred `inference` producer), the **Mythic Feedback Loop** (§4.10, the review's central point — legendary Beliefs as a new input to `worldviewOf`, Ambition selection, and Organization founding, so myths reshape cultures and institutions, not just what individuals believe), and **Director Myth-Awareness** (§4.11, subject-selection weighting only, explicitly not outcome bias). Revised sequencing (§6) to reflect that several "hard" items turned out to be one Rules field once correctly placed. |
| 1.2 | 2026-07-12 | Third-pass review: universality check with Tolkien deliberately set aside, testing §4.1–§4.11 against ASOIAF, Star Trek, Dune, 40K, Foundation, Mass Effect, and RimWorld (§5, new) — every item held up, several validated by near-exact matches already present in a shipped universe (Dune's Butlerian Jihad for Rules-based Decline; Mass Effect's Reaper cycles suggesting cyclic, not only linear, Age graphs; 40K's Ecclesiarchy and Dune's Bene Gesserit validating the Mythic Feedback Loop for both organic and *engineered* myth-seeding; §4.4 reframed as "exceptional-capability Actors" generally, not only deities). Addressed the "Historical Attractor" question (The Ring, the Iron Throne, the Golden Path, the Federation, Chaos, the Reapers, psychohistory, the Archotech) by tracing each example through existing mechanisms rather than arguing in the abstract: concluded it is an emergent steady-state of the Mythic Feedback Loop, not a missing primitive, and proposed an **Attractor Strength** reducer (§6, new) as the missing *legibility* piece — a pure read, no new Construct. Addressed mythic inflation by adding **the Law of Mythic Scarcity** (§7, new): legendary/sacred/attractor status must always be a reducer over a decaying Mark stack, never a stored flag — identified that `11 §Object`'s "historically significant" flag currently reads as exactly the stored-flag anti-pattern this law forbids, and sequenced its retrofit first (§9) since it protects everything minted after it. Renumbered former §5/§6 to §8/§9. |
| 1.3 | 2026-07-12 | Fourth-pass review response, prompted by the reviewer's observation that the Law of Mythic Scarcity (§7) reads like a general engine principle rather than a mythology-local one. Promoted it to `18-prime-movers.md` §"Significance is derived, never stored", canonical there now; §7 rewritten to point to it rather than restate it. Promoting the law prompted an actual codebase audit rather than continued document review, which corrected v1.2's claim: `11 §Object`'s "historically significant" flag is NOT a live bug (Object isn't implemented in the PoC yet, so the wording was tightened pre-emptively instead), but the audit found a real one in its place — `House.prestige` (`engine/model.ts`/`figures.ts`) is a plain stored, only-incrementing number with no decay path, exactly the "dynastic prestige" example the reviewer predicted. Not patched inline (it changes game balance, a product decision); spawned as a separate follow-up task instead. §9's sequencing item 1 updated to match. |
