# 27 — Lived-in Villages: A Community You Can See

**Document type:** Assessment + staged proposal — how a settlement stops reading as
static architecture on nice terrain and starts feeling like a place people live,
in the spirit of RimWorld's colonies (without RimWorld's cell-grid micro-sim).
**Companion documents:** `24-local-maps.md` (the Close View; §3.1 the aspatial law),
`25-venues-adr.md` (venues as the stage; §2 the no-dice law), `22-mood-and-causal-worldgen.md`
(self-thoughts), `23-precepts-belief-module.md` (creeds), `08-rimworld-study.md`
(Thoughts/Tales/Mood already adopted; ThinkTree/Jobs deliberately not).
**Status:** L1 (inhabitants on the map) + L2 (communal gatherings: weddings, funerals)
proposed here; L3–L6 staged below. Implementing L1+L2 first.

---

## 1. The gap (why a village doesn't feel lived-in)

MythOS already *computes* a living community: sourced-and-decaying opinions
(`opinion.ts`), mood as self-thoughts with mental breaks (`mood.ts`), feuds and
marriages that fire as real events (`resolve.ts`), personality-driven affinity
(`social.ts`), gossip that propagates belief (`belief.ts`), creed-conscience
(`conscience.ts`). That is the hard part, and it is done.

But the **village renders as static architecture**. `buildLocalPlan`
(`content/localmap.ts`) places only buildings, fields, and trees — never a person.
The only sign of an inhabitant is a "lit roof" you can hover. The rich `ActorView`
(mood, nature, relationships-with-causes) is reachable only by clicking through to
the inspector. And the community never *does* anything together: `hold_festival`
(`content/fixture.ts`) is an abstract polity treasury-spend with zero attendees; a
wedding is a two-actor state change wearing a hashed venue label; there are no
funerals at all.

So the gap is not "the sim needs more depth." It is: **the life the sim computes is
invisible, and the settlement never gathers.** RimWorld's lived-in feel comes from
two things MythOS lacks — you *see* people, and the colony *gathers* (parties,
funerals, rituals). Everything else, MythOS already out-computes it.

## 2. The principle that keeps this MythOS

RimWorld gets "lived-in" from a spatial/temporal micro-sim: pawns path to jobs on a
cell grid. MythOS **deliberately rejected that** (`24 §3.1`: "we do not move the
social simulation onto a cell grid; the Close View is a rendering of what the sim
already knows"). Do not fight it — it is the right call for a planet-scale sim.

The design line here, then:

> **Render the community the sim already computes, and add communal *events* that
> assemble named villagers at venues — without moving to a spatial/temporal
> micro-sim.**

Two consequences that every layer below obeys:

- **L1 is a derived reading, not new state.** Inhabitants on the map are a pure
  function of `households` + the plan, computed at build time, stored nowhere. The
  save is unchanged. (Same posture as L2-households in `24`.)
- **L2 gatherings obey the venue law where they can, and are honest where they
  can't.** *Selecting* who attends draws **no** `world.rng` (a pure function of the
  existing relationship graph + a hash tie-break, exactly like `pickVenue`
  in `25 §2`) — so adding gatherings does not re-roll any existing history. But a
  gathering *leaves mood self-thoughts on its attendees* (grief shared at a pyre,
  joy at a feast). Mood feeds mental breaks, so this genuinely perturbs the future —
  and it should: a village that mourns its dead is a real simulation deepening, not
  an annotation. That perturbation is the feature.

## 3. L1 — Put inhabitants on the Close View

**Goal.** The diorama goes from empty to inhabited the moment you see bodies. Static
figures are enough; no movement, no pathing.

**Model.** A new `PlanPerson` plan item (`content/localmap.ts`):

```ts
export interface PlanPerson {
  kind: 'person';
  x: number; y: number;          // world units
  tone: 'folk' | 'child' | 'notable' | 'mourner' | 'reveller';
  facing: number;                // radians — a crowd faces the square/pyre
  ref?: EventRef;                // a notable figure inspects its actor
  label?: string;                // hover: "Yowir Ianny, tanner"
}
```

**A new gen step, `Inhabitants`** (runs after `Houses`/`Livelihood`, before
`Palisade`), deterministic from the plan RNG:

- **At home.** For each *inhabited* house, place 1–3 figures in its yard/doorway,
  derived from that household's members (a `child` tone for the young). The notable
  head gets `tone:'notable'` and a `ref` to its actor.
- **At work.** Place figures at the livelihood structures the plan already lays down
  — a figure at the forge (`workshop`), one on a `pier`, one at the `mill`, folk in
  the `field`. Ties inhabitants to the settlement's specialization for free.
- **At the square.** A small clustered crowd around the `market square`, facing in —
  the town's public heart reads as occupied.
- **Density from population**, capped (≈ 40 figures) so a city doesn't become soup.

**Render.** `PlanGlyph` (`ui/LocalMapView.tsx`) gains a `person` branch: a tiny
figure (head disc + shoulders) in SVG world units, coloured by tone via CSS
(`styles.css`), hoverable, and — for a notable — clickable to the inspector. The 3D
view (`terrain3dGeo.ts` `buildStructures`) may render them as small billboards
later; L1 ships 2D.

**Payoff.** This single change does more for "feels alive" than anything else — you
see a peopled town, and the specialization becomes visible as *who is doing what*.

## 4. L2 — Communal gatherings (weddings, funerals)

**Goal.** The settlement *does things together*. A marriage draws the village; a
notable death draws mourners. Isolated two-actor events become communal ripples that
leave a mark on everyone who came.

**Model.** One generic engine mechanism, `engine/gathering.ts` — pack-agnostic (a
feast, a station-deck memorial, and a clan-mourning are all one object):

```ts
export type GatheringKind = 'wedding' | 'funeral' | 'feast' | 'rite';

// Assemble a gathering: pick a venue, emit a communal event, and mark every
// attendee with a mood self-thought. Draws NO world.rng (venue law, 25 §2).
export function holdGathering(
  world: World, kind: GatheringKind,
  focal: EntityId[],          // the 1–2 named principals (deceased / couple)
  attendees: EntityId[],      // the crowd — already alive-filtered, capped, deterministic
  cause?: EventId,
): EventId;
```

- **Attendees** come from `communityAround(world, focal, cap)` — the principals'
  living kin (spouse/parents/children/siblings) and strongest friends (edges with
  the `friend` flag / highest opinion), deduped, capped (≈ 8), ordered kin-first with
  a `mixSeed` hash tie-break. **No `world.rng`.**
- **Venue** via the existing `pickVenue(world, kind, …)` — new `VENUE_HOSTS`
  entries (`content/venues`): `wedding → [shrine, square, tavern]`,
  `funeral → [shrine, square]`, `feast → [square, tavern]`, `rite → [shrine]`.
- **Mood.** Each attendee gets a self-thought (new pack specs in `SELF_THOUGHTS`):
  `mourned` (a small *positive* — the comfort of shared grief and closure; the
  bereavement debuff itself is the separate `grief_kin`/`grief_spouse`) and
  `feasted` (a positive for a wedding/feast). The principals keep their existing
  thoughts (`newly_wed`, etc.).
- **Event + prose.** A new event type per kind, narrated in `content/narrative.ts`
  ("The folk of {settlement} gathered at {venue} to see {a} and {b} wed." /
  "{settlement} gathered to mourn {name} at {venue}."), scored by `eventInterest`
  so a funeral for a beloved figure surfaces in the Chronicle.

**Hooks (this cut):**

- **Wedding** — in `resolve.ts marry()`, after the `married` event and the couple's
  `newly_wed` thoughts: `holdGathering('wedding', [a,b], communityAround(…))`.
- **Funeral** — in `systems/lifecycle.ts` (natural death) and `resolve.ts brawl()`
  (violent death): capture mourners with `communityAround` *before* `killActor`
  prunes the deceased's edges, then `holdGathering('funeral', [dead], mourners,
  deathId)` after.

**Determinism.** Gathering *selection* is rng-free, so no existing dice move; the
mood thoughts perturb the future deliberately (§2). Snapshot tests that pin specific
downstream histories will shift and are updated; reproducibility/determinism tests
(same seed ⇒ same world) must still pass.

## 5. Staged follow-ons (not in this cut)

- **L3 — Feasts & rites.** Make `hold_festival` additionally assemble a `feast` of
  the focused settlement's notables; give each state creed a **holy-day** `rite` at
  its shrine where co-religionists gather (ties `23` precepts to a communal act).
- **L4 — Settlement social ticker.** Surface the social events already firing
  (chats, quarrels, courtships, aid), *typed and located*, scoped to the focused
  village — you watch the fabric move in place instead of reading a distant feed.
- **L5 — Individual texture on the map.** Notable-folk markers on their homes, a
  mood/role glyph on hover, profession icons on workplaces — bring `ActorView` out
  of the click-through inspector onto the map.
- **L6 — Deterministic daily rhythm.** Derive each notable's "current doing" from a
  day-phase function × personality (a recluse skips the tavern), a pure derivation
  that gives the place a pulse — the unifier for L1/L4/L5.

## 6. Decision-filter check (CLAUDE.md)

- **Improves the simulation?** L2 yes (a mourning/celebrating community with real
  mood consequences); L1 improves *legibility* of the existing sim.
- **Generic across universes?** Yes — `Gathering` and `PlanPerson` carry no fantasy
  vocabulary; a sci-fi pack supplies its own venues, tones, and thought labels.
- **Data-driven?** Gathering kinds → venues → mood specs all live in pack data;
  the engine holds only the mechanism.
- **Emergent?** Attendees are the *real* graph; who mourns whom is not scripted.
- **Legible / traceable?** "Why is everyone at the shrine? — it is Yon's funeral,"
  and each attendee's mood lists "mourned at a funeral" with the event as its cause.
- **Special cases?** None — one gathering object, one plan-item, the shared resolver
  and event/mood machinery.
