# Part 4 — Dwarf Fortress: Deep-Simulation & Worldbuilding Study

> Studied from the shipped `data/vanilla/**/objects` raws (Bay 12 Games / Kitfox,
> copyrighted). This is an architectural evaluation of *design patterns* — nothing
> is copied into MythOS. Quotes are short and illustrative.

Dwarf Fortress is the deepest emergent-narrative simulation ever shipped, and its
guiding promise is *exactly* MythOS's first pillar: **the player enters a world that
already exists, with a deep, readable past.** Where Warsim taught us *content
architecture* and RimWorld taught us *how a simulation tells a paced story*, DF
teaches three things neither did — and one cautionary lesson that is, for MythOS,
the most important takeaway of all.

---

## 1. Pre-play worldgen history — *the biggest thing all prior evals missed*

DF's signature is that before you play, it **simulates centuries of history**:
civilizations are founded, expand, war, and fall; historical figures are born, take
positions, kill, marry, write books, found sites, and die; artifacts are forged and
gain engraved histories; megabeasts ravage; sites rise and are razed; myths and
religions form. The result is **Legends mode** — every world ships with a queryable,
readable past, and play begins *in the middle of an ongoing story*.

Our Warsim and RimWorld evaluations both treated history as something that
*accumulates during play* (the chronicle, the event log). DF inverts the emphasis:
**the most important history happens before the player arrives.** This is literally
`CLAUDE.md`'s "World Before Player" pillar, and our PoC currently violates it — it
starts blank at year 0.

### What this means for MythOS — and why it's now *cheap* to do
We already have every piece needed: a deterministic sim, an aggregate/LOD layer
that runs O(1)/settlement/year, a Director that paces drama, a Chronicle that scores
and remembers, a Grammar that names eras, and migration/economy/geography. **A
worldgen pass is just running that machinery fast, at aggregate fidelity, for N
years before handing control to the player.** The player then arrives to:
- named eras and legends already in the chronicle,
- settlements with established populations, wealth, frontiers, and grudges,
- relationship/feud histories among the named (summary-tier) figures,
- a Director that has already shaped the world's mood.

This is the **single highest-leverage DF lesson** because it (a) realizes the
core vision pillar, (b) reuses everything we've built, and (c) is what makes a
world feel *lived-in* the moment you enter. It's the natural complement to
player-as-actor: a deep past to step into.

---

## 2. Civilizations as data-driven ethics + values — *the engine of cultural conflict*

A DF `ENTITY` (a civilization/culture) is defined largely by two token families
(`entity_default.txt`):

- **ETHICS** — a *stance on each kind of act*:
  ```
  [ETHIC:KILL_ENEMY:ACCEPTABLE]
  [ETHIC:SLAVERY:PUNISH_CAPITAL]
  [ETHIC:EAT_SAPIENT_OTHER:UNTHINKABLE]
  [ETHIC:THEFT:PUNISH_SERIOUS]
  [ETHIC:OATH_BREAKING:PUNISH_CAPITAL]
  ```
  Stances range over a scale (`ACCEPTABLE`, `PERSONAL_MATTER`, `ONLY_IF_SANCTIONED`,
  `SHUN`, `APPALLING`, `PUNISH_SERIOUS`, `PUNISH_CAPITAL`, `UNTHINKABLE`).
- **VALUES** — a *weighted priority* on each cultural value (−50…50):
  ```
  [VALUE:CRAFTSMANSHIP:50] [VALUE:LAW:30] [VALUE:FAMILY:30]
  [VALUE:NATURE:-15] [VALUE:MARTIAL_PROWESS:15] [VALUE:KNOWLEDGE:15]
  ```

Plus `RELIGION`/`SPHERE` (pantheon + domains — dwarves: fortresses, jewels, metals,
mountains, wealth) and `POSITION` (government offices: monarch, general, sheriff…).

### Why this is profound for MythOS
Ethics + values are **the principled, data-driven engine of emergent conflict and
behavior**:
- **Inter-culture war becomes legible and emergent.** Two cultures with opposed
  ethics (one `SLAVERY:ACCEPTABLE`, the other `SLAVERY:PUNISH_CAPITAL`) have a
  *reason* to clash; the engine doesn't need scripted wars. Dwarves find elves'
  reverence for trees alien; goblins' atrocities are `UNTHINKABLE` to others. The
  relationship graph's faction valence can be *derived* from ethical distance.
- **Individual behavior flows from values.** An actor of a `CRAFTSMANSHIP:50`
  culture gets satisfaction from making art; a `NATURE:-15` one doesn't mind
  deforestation; witnessing an act your ethics call `UNTHINKABLE` produces a strong
  negative **thought** (this plugs straight into our opinion-as-thoughts system).
- **It composes with RimWorld's Precepts** (the belief module we deferred) and is
  more systematic: ethics are the *moral* layer, values the *priority* layer,
  spheres the *thematic* layer, positions the *political* layer.

This is the model for a MythOS **Culture module**: a Universe Pack defines a
culture's ethics/values/spheres/positions as data; actors inherit them; violations
generate thoughts; ethical distance drives faction relations. **It is the
data-driven answer to "why do these peoples hate each other?"** — and it's exactly
the kind of generic, universe-agnostic primitive the engine should own.

### What prior evals missed
RimWorld's Precepts hinted at belief→thoughts, but DF's **ethics-as-moral-stances
driving inter-civ war** is the systematic, transferable version we under-weighted.
Warsim has faction relations but no *reasons* behind them. DF gives the reasons.

---

## 3. Meaningful procedural language — *names that mean things, per culture*

DF's naming is not syllable soup. It is a **concept dictionary + per-culture
translation**:
- `language_words.txt` is a language-independent dictionary of ~concepts, each
  tagged with parts of speech and grammatical roles:
  ```
  [WORD:MOUNTAIN] [NOUN:mountain:mountains] [THE_NOUN_SING] [OF_NOUN_PLUR] …
  ```
- each language realizes those concepts phonetically:
  ```
  language_DWARF: [T_WORD:ALE:mabdug] [T_WORD:ANCIENT:zustash] [T_WORD:GOLD:…]
  ```
- names are generated by **choosing meaningful concepts and translating + combining
  them grammatically**, yielding both a native name and a readable gloss
  ("Goldmountains", "The Bridge of Bronze").

### Why this matters
Our procgen (Warsim token lists, our Grammar primitive) makes names that *sound*
right; DF's make names that *mean* something and are **culturally consistent** (the
same culture's word for "gold" recurs across its place, person, and artifact names).
A founder named for the concept GOLD+HAMMER tells a tiny story; a fortress named
THE-DUTY-OF-IRON has thematic weight. This is the upgrade path for our Grammar:
**add a concept layer and per-culture lexicons**, so names carry meaning and a
culture's vocabulary is internally consistent. It also feeds the chronicle (an
artifact or era named for a concept becomes legible lore).

---

## 4. Secondary lessons & validations

- **Legends as a queryable database.** DF tracks every *historical figure*, event,
  site, and artifact as first-class records with full arcs (who killed whom, who
  held which office, who forged what). Our Chronicle is *event-centric and bounded*;
  DF is *entity-centric and total*. The lesson: keep a lightweight **historical-
  figure record** for the named (summary-tier) cast — their offices, kills,
  artifacts, and relationships — so the past is *queryable*, not just narratable.
  (Bounded by the summary tier, this stays cheap.)
- **Mythology/pantheon/sphere generation.** Spheres (domains like WEALTH, MOUNTAINS,
  WAR, DEATH) are the substrate DF uses to generate gods, myths, and thematically
  consistent magic/curses. A MythOS **mythology generator** (gods from spheres,
  myths from worldgen events) is a rich worldbuilding module, and spheres double as
  a culture's thematic fingerprint (already present as `RELIGION_SPHERE`).
- **Deep data-driven properties (materials/anatomy/descriptors).** DF pushes
  "everything is data" to the limit: every material has physical properties that
  propagate into items; bodies are part-trees; descriptors (colors/shapes/patterns)
  compose into appearances. This *validates* our data-driven direction — and is a
  cautionary tale (see §5). The transferable bit is **property propagation**: define
  properties once on a material/species and let them flow into items/appearance/
  description, rather than re-authoring per instance.
- **Interactions/syndromes as data.** Curses, diseases, were-beasts, necromancy are
  all **data-defined interactions with effects (syndromes)** — the same pattern as
  RimWorld Hediffs. Confirms a generic **effect/condition module** for MythOS magic.

---

## 5. The cautionary lesson — *DF's depth is also its curse* (most important for MythOS)

DF is the cautionary tale that should shape MythOS as much as its inspirations:

1. **Opacity.** DF simulates so much that players often *cannot tell why* things
   happen. Its emergent stories are legendary, but extracting them requires wikis,
   third-party tools, and folklore. **MythOS's bet is the opposite: DF-depth with
   legibility** — our causal event chains, opinion-reasons, and chronicle exist
   precisely so the player can *read* the why. Do not trade that away for depth.
2. **No Level-of-Detail → performance collapse.** DF tries to simulate everything at
   full fidelity and famously grinds to a halt in large/old forts. **Our LOD/
   aggregate/summary tiers are the discipline DF lacks** — they are what let us
   pursue DF-scale history without DF-scale lag. Hold the line on LOD.
3. **Determinism/replay absent.** DF worlds aren't reproducible from a small seed +
   inputs; ours are. That's a feature DF players would kill for (shareable seeds,
   replay, debugging).
4. **Brutal legibility curve / UI.** Depth with poor surfacing = inaccessible.
   MythOS must surface depth through views (the chronicle panel, inspector reasons,
   the map) — depth the player can *see*.

> **The meta-lesson: aim for DF's emergent depth, but keep RimWorld's pacing and our
> determinism + LOD + legibility.** MythOS's opportunity is to be "Dwarf Fortress you
> can understand, replay, and run at scale, in any universe." That is a genuine way
> to surpass DF, not clone it.

---

## 6. Prioritized recommendations for MythOS & the PoC

### Adopt next (high-leverage, reuses what we have)
1. **Worldgen pre-history pass** — before the player enters, run the existing sim
   fast at aggregate fidelity for N decades/centuries, producing established
   factions, populations, frontiers, a stocked chronicle (named eras + legends), and
   summary-tier figures with histories. *Realizes the core pillar; reuses
   everything; pairs perfectly with player-as-actor.* **Highest priority.**
2. **Culture module (ethics + values)** — a data-defined culture carries ethics
   (stances on acts) and values (weighted priorities); actors inherit them;
   violations emit opinion-thoughts; **faction relation valence is derived from
   ethical distance**, giving emergent, legible inter-culture conflict. Composes with
   the deferred RimWorld belief/Precept module.

### Adopt as the procgen/worldbuilding deepens
3. **Concept-layer naming** — extend the Grammar with a concept dictionary +
   per-culture lexicons, so names *mean* things and are culturally consistent
   (people, places, artifacts, eras). Feeds the chronicle's legibility.
4. **Historical-figure records** — a lightweight, queryable record for summary-tier
   notables (offices, kills, artifacts, kin) so the past can be *queried*, not just
   retold.
5. **Spheres → mythology** — generate gods/myths from spheres; spheres also tag a
   culture's theme and seed magic.

### Hold the line (the cautionary lessons, as ongoing constraints)
- **Legibility first** — every new depth must be *surfaced and explainable*.
- **LOD always** — never simulate at full fidelity what aggregate can carry.
- **Determinism preserved** — worldgen and all of the above stay seed-reproducible.

---

## 7. How the four studies now stack

| Source | Core lesson MythOS takes |
|--------|--------------------------|
| **Warsim** | Externalized, compositional, modifier-driven **content architecture** |
| **RimWorld** | **Storytelling craft**: Director (pacing), Thoughts (legible relations), Tales (history→content), Grammar |
| **Dwarf Fortress** | **Depth & the world-before-player**: pre-play worldgen history, ethics/values-driven culture, meaningful language, legends-as-database — *and the cautionary mandate to keep it legible, LOD'd, and deterministic* |
| **MythOS's own edge** | Universe-agnostic + deterministic + LOD + legible — *DF depth without DF opacity, in any setting* |

The through-line: **Warsim builds the world cheaply, RimWorld makes its story
followable, Dwarf Fortress makes its past deep — and MythOS's job is to do all three
at once, legibly and reproducibly, for any universe.**
