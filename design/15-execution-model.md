# MythOS Execution Model

**Document type:** Engine constitution — the simulation pipeline and runtime ordering.
**Companion documents:** `11-simulation-ontology.md`, `12-capabilities.md`, `13-simulation-rules.md`, `14-component-model.md`.
**Status:** Canonical. Changes require explicit revision with justification.

---

## Purpose

This document defines what happens during one tick of the simulation, in exactly what order.

The earlier constitutions defined *what exists*, *what each thing can do*, *what governs the world*, and *how state is stored*. This document defines *how the machine runs*.

If someone asks "what happens first?" — this document is the authoritative answer.

**Why ordering matters:** The simulation is deterministic. Two runs with the same seed must produce identical output at every tick. This is only possible if every system executes in the same sequence every time. That sequence is defined here. Any change to execution order is a breaking change that requires a save version bump and a revision to this document.

---

## The Simulation Pipeline at a Glance

```
Player Input
    ↓
stepTick()
    ↓
    ├── Daily Cadence   (every tick)
    │       └── Needs
    │
    ├── Weekly Cadence  (every N ticks, pack-defined)
    │       ├── Aspiration
    │       ├── Decision
    │       └── Resolution
    │
    └── Yearly Cadence  (every M ticks, pack-defined)
            ├── Lifecycle
            ├── Religion        ← focused settlement
            ├── Faction         ← focused settlement
            ├── Civil War       ← focused settlement
            ├── Succession      ← all settlements
            ├── Macro Pop       ← non-focused settlements
            ├── Geography       ← all edges
            ├── Economy         ← all settlements
            ├── Summary Aging   ← summary actors
            ├── Director
            └── Chronicle
                    ↓
Event Emission (embedded — fires during system execution)
                    ↓
Index Update
                    ↓
Snapshot (on demand, not every tick)
```

---

## Cadence Definitions

The simulation runs at three cadences. The length of each cadence is pack-defined but fixed for the duration of a world.

| Cadence | Default (fantasy pack) | Variable name |
|---|---|---|
| Daily | 1 tick | `TICKS_PER_DAY = 1` |
| Weekly | 7 ticks | `TICKS_PER_WEEK = 7` |
| Yearly | 365 ticks | `TICKS_PER_YEAR = 365` |

A sci-fi pack might use `TICKS_PER_YEAR = 365` with stardates calculated separately. A turn-based pack might use `TICKS_PER_YEAR = 52`. The engine does not know or care — it fires cadence systems at the specified intervals.

**Cadences are checked with modulo arithmetic:**
```
if (world.tick % TICKS_PER_DAY === 0) → daily systems
if (world.tick % TICKS_PER_WEEK === 0) → weekly systems
if (world.tick % TICKS_PER_YEAR === 0) → yearly systems
```

Multiple cadences can fire on the same tick. When they do, the order is: **daily → weekly → yearly**. Yearly contains the most expensive systems; if the daily systems produce state that yearly systems depend on, yearly sees the updated state.

---

## Before the First Tick: World Initialization

Before the simulation loop begins, the world is initialized from a seed:

```
createWorld(seed):
    1. Allocate world object with seed, tick = 0
    2. Initialize RNG streams (settlement, geography, director, figures, player)
       — each stream is a separate cursor into the seeded PRNG
    3. Generate Substrate from seed (terrain/geography — deterministic)
    4. Create initial Locations from pack data (placement driven by Substrate)
    5. Assign initial Cultures, Governments to each Location
    6. For the focused settlement: promote (materialize Actors from aggregate)
    7. Create HistoricalFigures for each settlement (founders, initial rulers)
    8. Run initial Economy setup (baseline stock, prices)
    9. Emit 'settlement_founded' events for each Location
   10. Initialize Director state
   11. Run Chronicle pass to seed initial Annals entries
```

World initialization is deterministic. The same seed always produces the same initial world state.

---

## The Tick Loop

### `stepTick(world)`

```
stepTick(world):
    world.tick += 1
    
    DAILY:
        if (tick % TICKS_PER_DAY === 0 && hasFocusedSettlement):
            needsDaily(world, fullActors(world))
    
    WEEKLY:
        if (tick % TICKS_PER_WEEK === 0 && hasFocusedSettlement):
            actWeekly(world, fullActors(world))
    
    YEARLY:
        if (tick % TICKS_PER_YEAR === 0):
            yearlyPass(world)
    
    updateIndexes(world)
```

---

## Daily Pipeline: Needs

**Runs:** Every tick, focused settlement only.
**Precondition:** `hasFocusedSettlement && fidelity === 'full'` for each actor processed.

```
needsDaily(world, actors):
    for each actor in actors:
        decay each need by its pack-defined rate
        clamp each need to [0, 1000]
    
    fasteningCheck(world):
        if (focused settlement stock[SUBSISTENCE_RESOURCE] === 0):
            emit 'famine_risk' event
            apply daily mortality to actors below subsistence threshold
```

**Order within daily:** All actors processed sequentially in ID order. ID order is used throughout for determinism. Actors are never processed in random or priority order unless explicitly defined by a system as ID-ordered.

**Why subsistence check is daily:** Famine is an acute event. Checking it yearly would mean a settlement could go 364 days without food and only experience one famine event. Checking daily allows famine mortality to accumulate properly and emit appropriate events.

---

## Weekly Pipeline: Decision and Resolution

**Runs:** Every 7 ticks (default), focused settlement only.

This is the emergence seam. Each adult Actor in the focused settlement decides an intent and resolves it. The result is world-state changes and events.

```
actWeekly(world, actors):
    adults = actors.filter(isAdult)
    
    for each adult in adults (in ID order):
        if (!isAlive(adult)) continue   ← may have died earlier this week from a brawl
        
        if (adult === world.playerId):
            intent = takePlayerIntent(world)    ← from the player input queue
        else:
            intent = decideActor(world, adult, adults)  ← aspiration → intent
        
        resolveIntent(world, adult, intent, world.rng)
```

### Decision: `decideActor`

```
decideActor(world, id, adults):
    aspiration = currentAspiration(world, id)
        ← evaluates which aspiration condition currently applies
        ← aspiration selection is priority-ordered; first match wins
    
    return intentFromAspiration(aspiration, world, id, adults)
        ← 'partner' aspiration → court(targetId) or socialize(targetId)
        ← 'settle' aspiration → work
        ← 'flourish' aspiration → socialize or idle
        ← etc.
```

**Aspiration evaluation is pure.** `currentAspiration` reads component state and returns a value. It does not write anything. No side effects.

### Resolution: `resolveIntent`

```
resolveIntent(world, id, intent, rng):
    switch intent.kind:
        'work':
            income = professionIncome(world, id)
            world.needs.get(id)[WEALTH_NEED] += income
        
        'socialize':
            addThought(getRel(world, id, intent.target), 'bonded', ...)
            world.needs.get(id)[SOCIAL_NEED] += SOCIAL_REFILL
        
        'court':
            bond = computeOpinion(getRel(world, id, intent.target), tick)
            if bond > MARRIAGE_THRESHOLD and canMarry(world, id, intent.target):
                marry(world, id, intent.target)     ← emits 'married' event
            elif bond < BRAWL_THRESHOLD and rng.chance(BRAWL_CHANCE):
                brawl(world, id, intent.target)     ← may emit 'died_brawl' event
            else:
                addThought(getRel, 'bonded', ...)   ← approaching bond
        
        'idle':
            world.needs.get(id)[MEANING_NEED] += MEANING_REFILL
```

**Resolution modifies world state and emits Events.** It is the only place in the weekly pipeline where world state changes. Decision is read-only.

**Player intents use the same resolver.** There is no `if (isPlayer)` inside `resolveIntent`. The player's intent goes through the same resolution path as every NPC. The only difference is who produced the intent.

---

## Yearly Pipeline

**Runs:** Every 365 ticks (default), all settlements.

The yearly pass is the most expensive and historically rich part of the simulation. It runs in a fixed order. That order is not arbitrary — each system produces state that later systems may depend on.

```
yearlyPass(world):
    year = tick / TICKS_PER_YEAR
    
    // ── FOCUSED SETTLEMENT (full fidelity) ──────────────────────────
    
    if hasFocusedSettlement:
        lifecycleYearly(world, fullActors)      [1]
        religionYearly(world)                   [2]
        factionYearly(world)                    [3]
        civilWarYearly(world)                   [4]
    
    // ── ALL SETTLEMENTS (aggregate and summary) ──────────────────────
    
    figuresYearly(world)                        [5]
    macroYearly(world)                          [6]
    geographyYearly(world)                      [7]
    economyYearly(world)                        [8]
    summaryYearly(world)                        [9]
    
    // ── WORLD LEVEL ──────────────────────────────────────────────────
    
    directorYearly(world)                       [10]
    chronicleYearly(world)                      [11]
```

### Why This Order

The ordering is not accidental. Each numbered annotation below explains why that system must run at that position.

**[1] Lifecycle — first in the focused pass**
Deaths and births happen before social systems run. A social system might try to reference an actor who died this year. By running lifecycle first, death is resolved before anything else reads the actor list. New births produce new actors that are available to later systems in this same yearly pass.

**[2] Religion — after lifecycle**
Religion operates on living actors. Running after lifecycle ensures newly dead actors are not processed for conversion or apostasy. Religion also fires events that can affect relationships, so it must run before the snapshot is built.

**[3] Faction — after religion**
Faction detection uses the personality values of living actors and may be influenced by religious alignment. Running after religion ensures any faith-driven personality shifts from the same year are visible.

**[4] Civil War — after faction**
Civil war resolution depends on the current faction split, which is computed by factionYearly. Running immediately after ensures the civil war system uses the freshest split data.

**[5] Succession — before macro**
Succession may depend on whether a Location has been ruined. It runs before macroYearly so it can fire succession events on Locations that are about to be marked ruined by macro dynamics.

**[6] Macro Population — after succession, before geography**
Macro population (aggregate settlement dynamics) must run after succession (so newly appointed rulers are in place) and before geography (so raid targets have current populations).

**[7] Geography — after macro**
Geography handles raids and relation drift. Raids damage populations — they must see the current year's population, not last year's. Raids also affect stocks (economy), so geography must run before economyYearly.

**[8] Economy — after geography**
Trade flows use current stock levels. Raids (geography) deplete stocks before trade runs, so trade responds to raid damage within the same year.

**[9] Summary Aging — after all demographic systems**
Summary actors are aged and killed after all major demographic events are resolved. This keeps summary aging from interfering with succession or macro population calculations.

**[10] Director — after chronicle, reads drama signal**
The Director reads the Chronicle to measure recent drama. The Chronicle must be up-to-date before the Director decides whether to fire an incident.

Wait — the Director actually runs before Chronicle in the above ordering. Let me clarify the dependency:

The Director reads the Chronicle as it existed *at the end of last year*, not this year's additions. The Chronicle compaction for this year's events runs at [11] after the Director. This means:

- **Director [10]** sees drama from events up through last year's chronicle compaction.
- **Chronicle [11]** ingests this year's new events and compacts the history.

This is the intended behavior. If the Director fired an incident this year, the Chronicle at [11] will record it, and next year's Director will see it as drama that relieves tension.

**[11] Chronicle — last in the yearly pass**
Chronicle compaction reads all new events emitted during this year's pass (lifecycle deaths, religion conversions, civil wars, raids, director incidents — all of it) and scores them for interest. Running last ensures nothing is missed.

---

## Event Emission

Events are not batched at the end of a tick. They are emitted inline by systems as world-state changes occur.

```
emit(world, type, subjects, data, causes?):
    event = {
        id: world.nextEventId++,
        tick: world.tick,
        year: Math.floor(world.tick / TICKS_PER_YEAR),
        type,
        subjects,
        data,
        causes: causes ?? []
    }
    
    world.events.push(event)
    
    // Index updates (immediate — not deferred)
    for each subject in subjects:
        world.eventsBySubject.get(subject).push(event.id)
    
    // Memory update
    for each subject in subjects:
        world.memory.get(subject)?.push(event.id)
        pruneMemory(world, subject)    ← enforce memory cap
    
    // Perception: may generate Reputation marks
    perceptionPass(world, event)
```

### Perception Pass

Immediately after an event is emitted, the Perception system checks whether the event should generate Reputation marks for its subjects.

```
perceptionPass(world, event):
    spec = reputeSpecForEvent(event.type)    ← from pack data
    if (!spec) return                         ← most events don't generate reputation
    
    witnesses = countWitnesses(world, event)
    if witnesses === 0: return
    
    for each subject in event.subjects:
        if isAffectedByRepute(event, subject):
            addReputeMark(world, subject, spec.kind, witnesses, event.id)
```

Witness counting: a witness is any full-fidelity actor in the same Location as the event's subjects. For events involving non-location-specific subjects, witness count defaults to the settlement's adult population (scaled by visibility — a public event is witnessed by more than a private one; scaling is pack-defined).

---

## Index Update

After all systems in a tick have run, derived indexes are verified for consistency:

```
updateIndexes(world):
    // Sweep for stale entries (actors who have died or been demoted)
    // These checks are cheap (O(dead + demoted) not O(all actors))
    
    purgeStaleEventsBySubject(world)     ← remove entries for freed actors
    purgeStaleEventsBySettlement(world)  ← remove entries for ruined settlements
    purgeStaleMemory(world)              ← remove memory entries for freed actors
    purgeStaleFigureIndex(world)         ← remove figuresBySettlement entries for ruined settlements
```

This is a sweep, not a full rebuild. The implementation tracks dirty flags so only recently changed indexes are checked.

---

## The Snapshot Pipeline

The UI does not read world state directly. It reads a **Snapshot** — a pure data object produced on demand.

**The Snapshot is not produced every tick.** It is produced when the UI requests it (typically after a configurable number of ticks have passed, or on a user-driven pause).

```
buildSnapshot(world) → Snapshot:
    // All reads are read-only. Nothing in the snapshot builder writes to world state.
    
    actors   = buildActorViews(world, fullActors(world))
    events   = buildEventViews(world, recentEvents(world))
    settlements = buildSettlementViews(world)
    map      = buildRegionMapView(world)
    chronicle = buildChronicleView(world)
    figures  = buildFigureViews(world)
    houses   = buildHouseViews(world)
    player   = buildPlayerView(world)
    director = buildDirectorView(world)
    
    return Snapshot { year, tick, seed, ... all of the above }
```

**Prose is rendered in the snapshot builder, not stored in Events.** When an Event is added to the snapshot's `recentEvents` list, the snapshot builder calls `renderEvent(world, event)` → `{ text, parts }`. The prose does not exist in the world state — it exists only in the snapshot, transiently.

**The snapshot is the boundary between simulation and presentation.** Nothing above the snapshot line knows or cares about React. Nothing below the snapshot line knows or cares about how text is displayed.

---

## Player Input

The player does not directly modify world state. They submit **Intents** through the UI, which are queued on the world and consumed during the weekly Decision phase.

```
// UI thread → Worker thread
submitPlayerIntent(intent):
    world.playerInputs.push({ tick: world.tick, intent })

// During actWeekly, when processing the player actor:
if (actor === world.playerId):
    intent = takePlayerIntent(world)    ← pops the most recent queued intent
    resolveIntent(world, actor, intent, world.playerRng)
```

**Player intents use a dedicated RNG stream** (`playerRng`). This isolates player actions from the NPC RNG sequence. An NPC's fate is not changed by whether the player clicked "socialize" or "work" this week.

**Player inputs are an append-only log.** Every submitted intent is recorded with its tick. This enables:
- Future replay (run the world from tick 0 with the same inputs → identical outcome)
- Save/load (saved inputs resume from where the player left off)
- Analysis (what did the player do this session?)

**If no player intent is queued**, the player actor falls back to NPC aspiration-driven behavior. The player never "stalls" the simulation by failing to submit an intent.

---

## LOD Management: Focus Changes

Focus changes are player-driven and happen *between* ticks, not *during* them. The simulation is paused while a focus change is processed.

```
focusSettlement(world, newId):
    // Must not be called during a tick — only between ticks
    
    // 1. DEMOTE current focused settlement
    if (world.focusedSettlementId >= 0):
        old = world.settlements[world.focusedSettlementId]
        old.detailed = false
        old.rngState = world.rng.state      ← save the RNG cursor for next time
        
        fullActorsHere = fullActors(world).filter(homeSettlement === old.id)
        notables = selectNotables(world, fullActorsHere, MAX_SUMMARIES)
        
        for each actor in fullActorsHere:
            if actor in notables:
                world.fidelity.set(actor, 'summary')
                // Identity, Personality, Faith, Relationships, Reputation retained
                // Needs, transient Thoughts pruned
            else:
                removeActorCompletely(world, actor)     ← freed; aggregate carries them
        
        old.epoch++     ← diverges future RNG re-generation from prior promotions
    
    // 2. PROMOTE new focused settlement
    new = world.settlements[newId]
    new.detailed = true
    world.focusedSettlementId = newId
    world.rng.state = new.rngState          ← restore this settlement's RNG cursor
    
    promote(world, new)
        ← promotes existing summaries from 'summary' to 'full'
        ← mints fresh full actors to fill out the settlement from aggregate

// promote() never fires events — the new actors just appear
// They will participate in the next tick's weekly system
```

**The epoch bump** is critical for determinism. If the same settlement is focused, demoted, and re-focused, the RNG cursor continues from where it left off (restored from `rngState`). If it's focused for the first time, it starts from its initial allocation. The epoch flag prevents a demoted-and-repromoted settlement from generating the same actors it had before (which would be incorrect — the aggregate population has continued to evolve).

---

## Save and Load

### Save

```
save(world) → SaveFile:
    // Serialize all component maps as [key, value][] arrays
    // Relationship graph uses pooled edges to preserve shared-edge invariant
    // Substrate is NOT serialized — regenerated from seed on load
    // Player inputs are serialized in full (enables replay)
    // RNG state cursors are serialized as integers
    // Current save version is bumped on any schema change
```

### Load

```
load(saveFile) → World:
    // Check save version; run migration if needed
    // Reconstruct all component maps from serialized arrays
    // Reconstruct relationship graph from pooled edges + adjacency lists
    // Regenerate Substrate from seed (deterministic — always matches original)
    // Restore all RNG state cursors
    // Rebuild derived indexes (eventsBySubject, figuresBySettlement, etc.)
    // Verify invariants (no ID collisions, no containment cycles, etc.)
```

**Save version history:**
- v5: baseline
- v6: separated alive/dead entity lists
- v7: reconstructed stats from event log (backward compat)
- v8: added Faith, Exiles, Houses (current)

Each migration function transforms the prior format to the current format. Multiple hops are supported (v5 → v6 → v7 → v8 in sequence).

**Save files are the authoritative state.** There is no hidden runtime state that does not appear in the save file. If the simulation cannot be fully reconstructed from a save file, that is a bug.

---

## The Worker/Thread Boundary

The simulation runs in a Web Worker. The UI runs on the main thread. Communication is through a typed message protocol.

```
// Main thread → Worker
WorkerMessage:
    | { type: 'step', count: number }           ← advance N ticks
    | { type: 'focus', settlementId: number }   ← focus a settlement
    | { type: 'intent', intent: Intent }        ← player submits intent
    | { type: 'save' }                          ← request save data
    | { type: 'load', saveData: SaveFile }      ← load a world
    | { type: 'snapshot' }                      ← request a snapshot

// Worker → Main thread
WorkerResponse:
    | { type: 'snapshot', snapshot: Snapshot }  ← UI update
    | { type: 'saved', data: SaveFile }         ← save response
    | { type: 'error', message: string }        ← error
```

**The main thread never holds world state.** It holds only the most recent Snapshot. This means the UI is always reading from a clean, immutable data object — not from live simulation state.

**The Worker processes one message at a time.** There is no concurrent access to world state. Messages are queued; the Worker processes each one to completion before reading the next.

---

## Invariants of the Execution Model

The following must hold at all times during execution:

1. **No system runs out of order.** The sequence defined in this document is fixed. Any deviation is a bug.
2. **No system writes to another system's output during that system's pass.** Writers are declared. Undeclared writes are violations.
3. **`emit()` is the only way to create Events.** Systems do not directly push to `world.events`. They call `emit()`, which handles indexing, memory, and perception.
4. **LOD changes only happen between ticks.** `focusSettlement()` must not be called during `stepTick()`. If the player requests a focus change while the simulation is running, the request is queued and processed on the next inter-tick gap.
5. **The snapshot builder does not write to world state.** It is strictly read-only. Any write inside the snapshot builder is a bug.
6. **Player intents do not bypass the resolver.** The player's intent goes through `resolveIntent()` like every other intent. There is no `applyPlayerAction()` that bypasses the shared logic.
7. **Math.random() is never called.** All randomness uses the seeded RNG through one of the declared streams (settlement, geography, director, figures, player).
8. **Observation does not constitute history; only actions become history.** A purely informational layer — perception, worldview, intent, any derived reading of the world — must never emit Events, write to the chronicle/annals, or alter another system's state. It produces an inspectable record (e.g. `world.currentIntent`) read only by the snapshot builder and the determinism hash. The moment such a layer emits an Event, it becomes *causative*: that Event can feed the Director, shift seeded drama, and perturb otherwise-stable outcomes. Reasoning is not a participant in history. (Discovered in Phase 2C: an `intent_changed` event from the reasoning overlay entered the chronicle, the Director read it, and seed-tuned drama diverged. Run-vs-run determinism held; the leak was architectural, not numeric.)
9. **Reasoning must never emit historical Events directly — only the attempt or outcome of an ACTION may enter the event log.** Intent answers *"what should I do?"*; it is inert. Execution answers *"can I do it?"* and produces the Event. An attempt that fails is still history ("attempted expansion — failed"); an intent that is never acted on is not. This is the bright line between the Reasoning layer (Perception → Worldview → Intent) and the Execution layer (Intent → Attempt → Outcome → Event).

10. **Beliefs never modify reality directly. They modify decisions, and only decisions modify reality.** A Belief — like any subjective Mark — is a read-only input to reasoning. It may change what an entity *intends*, and an intent may become an Action whose outcome writes to reality, but no belief may write world state on its own. The permitted chain is **Reality → Belief → Reasoning → Intent → Action → Outcome → Reality**; the forbidden shortcut is **Belief → Reality**. This is what keeps a false belief from silently corrupting the objective record: a kingdom that *believes* its king still lives changes only its decisions, never the fact of his death. (Formalized with the Epistemics ADR, `17`.)

These invariants formalize the engine's layering of civilization: **Reality → Perception/Belief → Reasoning → Action → History**, each a distinct stage. Observation and belief are subjective reads — they emit no events; only the Action stage writes to the event log, and only Reality, never Belief, is objective.

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-28 | Initial execution model — defines tick pipeline (daily/weekly/yearly cadences), system execution order within yearly pass with ordering rationale, event emission and perception pipeline, snapshot build pipeline, player input queue, LOD focus change protocol, save/load lifecycle, worker/thread boundary, and 7 execution invariants |
| 1.1 | 2026-06-29 | Added execution invariants 8 (observation does not constitute history) and 9 (only an action's attempt/outcome may emit historical Events), formalizing the Perception → Reasoning → Action → History layering. Narrowly justified amendment exposed by the Phase 2C reasoning overlay (an intent event leaked into the Director and perturbed seed-tuned drama). |
| 1.2 | 2026-07-03 | Added execution invariant 10 (**beliefs never modify reality directly — only decisions do**), extending the causal chain to **Reality → Belief → Reasoning → Intent → Action → Outcome → Reality** and forbidding the **Belief → Reality** shortcut. Introduced with the Epistemics ADR (`17`) ahead of the Belief layer. |
