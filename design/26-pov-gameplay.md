# 26 — POV Gameplay: Living One Life Well

**Document type:** Assessment + staged proposal — how "live as one of them" gets
cleaned up and pulled toward what Crusader Kings, RimWorld and Warsim each do best.
**Companion documents:** `21-the-subjective-journal.md` (the cockpit constitution),
`16-interaction-principles.md` (org discipline the ruler-levers must respect),
`01-warsim-analysis.md` §2.2 (throne-room petitioners), `25-venues-adr.md`.
**Status:** P1 (autopilot), P2 (audiences), P3 (value-tinted choices + conscience),
P4 (steer the polity), P5 (leaving home) SHIPPED (2026-07). P1 note: the
standing-order lean was deferred — the aspiration decider alone sufficed. P4 note:
shipped as a "heavier vote" — the ruler picks among the org's OWN top intents,
honoured only while the org still rates the pick a contender (bounded-knowledge
intact); a mandate lapses if unrenewed. P5 note: a RAILS operation (`leaveFor`,
beside possess/inherit), not an act-loop action — a focus shift demotes/promotes
whole casts and cannot run mid-week; the player leaves alone in v1 (family follows
later). P6 (cockpit cleanups) SHIPPED: the week answers back (a UI-diff strip of
your new story beats after each deed/held year), the target picker retired behind
an "act on your own" fallback so situated verbs lead, copy ("step out of this
life", "live the week"), and a new `family_birth` commoner decision. All of
design/26 is now shipped.

---

## 1. What already stands (and must not be broken)

- **Possession is philosophically perfect.** `playerId` is the only difference; the
  player's intents ride the same act loop, the same resolver, their own rng stream,
  and a replayable input log. Mental breaks preempt the player's chosen intent with
  no exemption — the design pillar, working.
- **The cockpit speaks from inside one head** (design/21): situation, mood with
  reasons, one attention feed, the journal. The Decisions chassis (pure-read
  `DecisionDef`s over real state) and the Ambitions ladder are the right shape.
- **Death is a transition** — heirOf/inheritHeir, the line followed across
  settlements. Time flow now holds on new decisions and on death.

## 2. The gaps, each named against its inspiration

### G1 — Your character stops living when time runs (the biggest flaw)
`takePlayerIntent` falls back to `{kind:'idle'}` for any week with no scheduled
input. Press play as a possessed character and they **rest for years**: no income,
no bonds, mood decaying — the streaming-time feature actively punishes possession.
CK's model: the character keeps living; the player *intervenes*.

### G2 — Verbs are generic and placeless; the action bar is a form
Six universal verbs + two dropdowns + "(1 week)". Everyone from farmer to lord has
the same menu, aimed via a `<select>` of names. CK grants verbs by POSITION;
Warsim by SITUATION (menus of things in front of you); RimWorld's verbs emerge
from context. We now have venues, households, and attention lines — the world is
full of clickable *situations* the action system ignores.

### G3 — The seat is a trophy, not a job
The `rise` ambition ends at `press_claim`; `fulfilled: isRuler` — and then the
ruler has exactly the verbs a farmhand has. CK is entirely "the job of being your
position"; Warsim's crown jewel is the **throne room**: a stream of petitioners
brought TO you. Our polity org reasons yearly with legible factors, settlements
hold real feuds/factions/economies — everything an audience system needs already
exists as state.

### G4 — Choices don't express character
CK options are trait-gated and acting against your nature costs stress. MythOS
already has per-actor values/temperament AND the precepts→conscience machinery
(guilt/pride self-thoughts into mood) — but decision options are the same for
every soul, and choosing against your nature costs nothing.

### G5 — Acting gives no answer
Click "Work ▸" and the snapshot silently swaps. Every inspiration answers an
action (RimWorld letters, CK event outcomes, Warsim's report lines). The data for
"what your week became" already exists (story beats, attention diffs) — it just
isn't SURFACED at the moment of action.

### G6 — You can never leave home
No travel verb. Emigration exists as a sim event, travel as engine machinery, and
inheritance already moves the focus across the map — but a living player is
pinned to their birthplace.

## 3. The proposal, in priority order

### P1 — The autopilot: your character lives; you steer (small, transformative)
When no player input is scheduled for the week, fall through to the **same NPC
decider** every other soul uses (aspiration-driven), instead of idling. Purity
bonus: this is *more* aligned with "every character is equal", not less. Add a
**standing order** (a persisted lean: pursue ambition / work / rest) the decider
weighs, so play mode reads: press play → watch your life unfold on the map →
time holds when the world asks → choose → play. Determinism unaffected:
possession is an input; the decider draws the same streams it always does.

### P2 — Audiences: Warsim's throne room from real state (the jewel)
Ruler-only `DecisionDef`s that read the settlement and bring its troubles to the
seat: two households in open feud ask judgment (real `rels` edges — siding emits
real opinion/reputation effects); the shrine asks funds (real treasury); a faction
split asks recognition; an exile begs return; a neighbour polity's envoy carries
its real 2E proposal. Cadence-gated (a petition a season, not a spam). ZERO new
simulation: audiences are a legible WINDOW onto systems already running, and every
verdict flows through existing intents/effects. This single feature makes the
seat a job and closes the loop the `rise` ambition currently drops.

**P2 envoy — SHIPPED (2026-07, the 2E player-diplomacy slice).** The line above
("a neighbour polity's envoy carries its real 2E proposal") is now built.
INCOMING: when the NPC diplomacy pass (`orgInteractionYearly`) addresses a proposal
to the polity the player RULES, it is PARKED (`world.pendingEnvoy`, player-only)
instead of auto-resolved; the `audience_envoy` DecisionDef surfaces it and the
player's accept/reject (`answer_envoy`) replaces the recipient's `evaluate()`,
flowing through the same shared outcome tail (`applyProposalOutcome`) — so a pact
the player seals binds exactly as one the world negotiates without them (two
histories, institutional stance, agreement-with-teeth). OUTGOING: a ruler-player
proposes a pact (trade / non-aggression) to a neighbour from the settlement
inspector (`SettlementDetail.diplomacy` → `propose_pact`); the NEIGHBOUR's own
bounded view decides (the player is a proposer, never a god-hand). Player-only:
an NPC/spectator world never parks an envoy, so its diplomacy is byte-identical
(determinism suite green). See the interaction pipeline in `design/16`.

### P3 — Choices wear your character (small)
`DecisionOption` gains an optional value-axis tint: options aligned with the
actor's strongest values read marked ("*honour*"); choosing an option OPPOSED to
a strong value emits the existing conscience self-thought into mood (guilt), and
aligned choices a small pride. Reuses precepts wholesale; suddenly two different
souls play the same dilemma differently — CK's trait-gating, derived not scripted.

### P4 — Role verbs through the org, bounded (medium)
The seated player steers the polity the CK-council way WITHOUT breaking org
discipline (design/16): once a year the org's reasoning surfaces its top intents
— the ruler picks among them (or abstains → the org's own choice stands). The org
still perceives with bounded knowledge and executes through its own resolver; the
player is a heavier vote, not a god-hand. Pack adds role affordances the same
data-driven way PLAYER_ACTIONS works today.

### P5 — Leaving home (medium) — SHIPPED
"Leave home for X" as a player rails operation (`engine/player.ts` `leaveFor`,
beside possess/inherit): rides the same emigration bookkeeping any adult uses —
drop to the summary tier, rehome, move one head between the towns' ledgers — then
`focusSettlement` moves attention, exactly as inheritance follows an heir; the
destination's promote raises the now-summary player back to full. A rails op, NOT
an act-loop action: a focus shift demotes/promotes whole casts and would free
actors mid-`actWeekly`. Also hardened `demote()` so a possessed actor is always a
survivor — a shifting gaze moves attention, never erases the life. Player leaves
ALONE in v1 (spouse/children stay; ties persist as a story). Opens
courtship/feuds/claims in a second town — the world stops being one village deep.
Future: family-follows, transit time via `travel.ts`, arrival-at-the-gate close
view.

### P6 — Cockpit cleanups (small, anytime) — SHIPPED
The week answers back: `useFreshBeats` (PlayerCockpit) diffs `player.story`
between snapshots purely in the PRESENTATION layer (the engine stays a pure read)
and renders a compact "Since last you looked" strip of the beats that touched YOU;
every action clears it first, so the strip that follows is exactly what that deed
became, and a held year accumulates the year's beats (capped ~6). Baselines on a
`playerId` change so an inherited soul isn't greeted by a flood. Retired the
always-open target `<select>`: the "live the week" primary + situated verbs
(Pursue, the world's decisions, attention lines) lead; the action/target form
folds into an "act on your own" fallback disclosure. Copy: "release" → "step out
of this life"; "(1 week)" → "live the week". New commoner decision `family_birth`
(content/decisions.ts): a `born` event of the past week where the player is a
parent → rejoice with the co-parent / provide (work) / hold them close (idle) —
a pure read over the three generic verbs, no new mechanism. Courtship (marriage
offer via `bestSuitor`) already existed; coming-of-age deferred (no maturity event
to key off). Verified live: a 10-year autopilot run surfaced a five-beat strip
(goal met, a child born, a quarrel, a kindness, a friendship) AND the family_birth
decision in the same frame.

## 4. What NOT to do

No scripted quest chains (decision content must stay pure reads of real state);
no player-only mechanics or stats (the equality pillar); no CK lifestyle/XP trees
unless they arrive as pack data for ALL actors; no free-text command parsing
(surfaced affordances, per the constitution).

## 5. Decision-filter check

Simulation-first: P2/P4 expose running systems, they don't add scripted ones.
Generic: verbs, audiences, tints are pack data. Emergent: every audience is
generated by real edges and treasuries. Legible: each petition names its cause
and each verdict lands as traceable events. Equal: P1 makes the player MORE like
an NPC, not less. Five years: the org-mediated ruler is the only shape that
survives multi-settlement realms.
