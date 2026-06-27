# Part 5 — The Intent / Resolver Seam (Player-as-Actor, Step 1)

The single refactor that turns MythOS from a *spectator* simulation into a
*playable* one — without ever writing `if (isPlayer)` inside a rule.

This document designs the seam concretely against the **current** code
([`systems/social.ts`](../poc/src/systems/social.ts) and
[`systems/needs.ts`](../poc/src/systems/needs.ts)). It is deliberately scoped to
"step 1" of the player-as-actor work (see `06 §3 Phase 2`): make NPC behaviour
flow through an explicit intent, so the player can later substitute one producer
of intents without touching the resolver.

---

## 1. The problem this solves

Today a system both **decides** and **does** in one fused step. In
`socialWeekly`:

```ts
const b = choosePartner(world, a, adults); // DECIDE
interact(world, a, b);                      // DO (mutates, emits, escalates)
```

There is no value anywhere that represents *"actor a chose to do X."* So there is
no seam to feed a player's choice into — any attempt to add one forces an
`if (isPlayer)` branch inside the rule, which `CLAUDE.md` forbids ("never separate
code paths for Player / NPC").

**The fix:** split every action into two halves —

1. **decide** → produce a serializable `Intent` from actor state, and
2. **resolve** → a *shared* function that applies the intent's effects.

NPCs get an auto-decider for half 1. The player substitutes UI input for half 1.
**Half 2 is identical for both.** This is the roadmap's "one rule set, two intent
producers" (`06 §6`) made real.

The `if (a === playerId)` we *do* write lives only in **intent-source selection**,
never in the resolver. That distinction is the whole design.

---

## 2. The `Intent` type

A small, serializable, universe-neutral vocabulary. Serializable matters: intents
go into a replay log (see §6), so saves/replay/eventual-multiplayer stay
deterministic.

```ts
// engine/intent.ts
export type Intent =
  | { kind: 'idle' }                                  // do nothing this tick
  | { kind: 'work' }                                  // ply your profession
  | { kind: 'socialize'; target: EntityId }           // spend time with someone
  | { kind: 'court'; target: EntityId }               // pursue a bond toward marriage
  | { kind: 'give'; target: EntityId }                // a deliberate kindness
  | { kind: 'provoke'; target: EntityId };            // a deliberate slight
```

Mapping onto today's behaviour:

| Intent | Current equivalent | Effect (resolver) |
|---|---|---|
| `work` | the income lines in `needsDaily` | raises `wealth`/`food` needs |
| `socialize` | `interact()` | bonded/quarrelled thought, maybe a notable kindness/dispute, then `promote()` |
| `court` | emergent inside `interact`→`promote` | positivity-biased `socialize` that also *attempts* marriage when eligible |
| `give` / `provoke` | the rare notable branches in `interact` | a guaranteed `kindness` / `slighted` thought + event |
| `idle` | the `chance(0.55)` "no interaction" path | nothing |

**v1 NPCs only ever emit `work` / `socialize` / `idle`** — exactly enough to
reproduce current behaviour. `court` / `give` / `provoke` exist for the *player's*
agency now, and become available to smarter NPC AI later (richer deciders, no
resolver change).

---

## 3. The NPC decider (intent producer #1)

A pure-ish function: reads state + the settlement RNG, returns one intent. This is
the *only* place NPC "free will" lives, so future AI depth lands here without
touching resolution.

```ts
// systems/decide.ts
import { type World, type EntityId } from '../engine/model';
import { type Intent } from '../engine/intent';
import { choosePartner } from './social'; // exported from social.ts

export function decideActor(world: World, a: EntityId): Intent {
  const rng = world.rng;
  const needs = world.needs.get(a)!;

  // needs → goal: subsistence first. This is the need-gating that needs.ts
  // currently lacks — hunger/poverty now *motivate* an action instead of just
  // drifting a number.
  if (needs.food < 300 || needs.wealth < 250) return { kind: 'work' };

  // otherwise be social, at the same activity rate as today's socialWeekly
  if (!rng.chance(0.55)) return { kind: 'idle' };
  const b = choosePartner(world, a); // unchanged partner-selection logic
  if (b === undefined) return { kind: 'idle' };
  return { kind: 'socialize', target: b };
}
```

> `choosePartner` already exists in `social.ts`; export it (drop the `adults`
> param by reading `fullActors` inside, or keep it — either is fine, just one
> signature). Marriage/feud/rivalry still *emerge* from repeated `socialize` via
> `promote()`, so the decider stays this simple.

---

## 4. The resolver (shared by NPC and player)

The current `interact()` becomes `resolveInteract()` with a positivity `bias`
knob (0 for ambient socializing, >0 for courting). Everything else — `pruneThoughts`,
`pairAffinity`, `computeOpinion`, the bonded/quarrelled thought, the notable
kindness/dispute branch, `promote`, the feud brawl — is preserved verbatim.

```ts
// systems/resolve.ts
import { type World, type EntityId } from '../engine/model';
import { type Intent } from '../engine/intent';
import { getRel, emit, isAlive, clamp } from '../engine/world';
import { addThought, computeOpinion, pruneThoughts } from '../engine/opinion';
import { pairAffinity } from '../content/fixture';
// promote()/brawl() move here from social.ts (or social.ts re-exports them)

const PROFESSION_INCOME: Record<string, number> = {
  farmer: 3, smith: 5, guard: 4, trader: 6, healer: 4, hunter: 4,
};

/** ONE rule set. No player branch anywhere below this line. */
export function resolveIntent(world: World, a: EntityId, intent: Intent): void {
  if (!isAlive(world, a)) return; // may have died earlier this tick
  switch (intent.kind) {
    case 'idle': return;
    case 'work': return resolveWork(world, a);
    case 'socialize': return resolveInteract(world, a, intent.target, 0, false);
    case 'court': return resolveInteract(world, a, intent.target, 0.15, true);
    case 'give': return resolveGift(world, a, intent.target);
    case 'provoke': return resolveProvoke(world, a, intent.target);
  }
}

function resolveWork(world: World, a: EntityId): void {
  // income that USED to be passive in needsDaily — now earned by a chosen action,
  // for everyone. Weekly cadence, so it grants ~a week of subsistence at once.
  const n = world.needs.get(a)!;
  const prof = world.profession.get(a)!;
  n.food = clamp(n.food + 45, 0, 1000);
  n.wealth = clamp(n.wealth + (PROFESSION_INCOME[prof] ?? 3) * 7, 0, 1000);
}

function resolveInteract(
  world: World, a: EntityId, b: EntityId, bias: number, tryMarry: boolean,
): void {
  if (!isAlive(world, b)) return;
  const rng = world.rng; // NB: for the PLAYER this is the player stream — see §6
  const edge = getRel(world, a, b);
  pruneThoughts(edge, world.tick);
  const affinity = pairAffinity(world.traits.get(a)!, world.traits.get(b)!);
  const opinion = computeOpinion(edge, world.tick);

  const pPos = clamp(0.56 + bias + affinity * 0.1 + opinion * 0.00025, 0.05, 0.95);
  const positive = rng.chance(pPos);
  const magnitude = positive ? rng.range(25, 120) : rng.range(20, 105);
  addThought(edge, positive ? 'bonded' : 'quarrelled', world.tick);

  const settled = edge.flags.friend || edge.flags.spouse || edge.flags.feud;
  if (!settled && magnitude > 95) {
    if (positive && rng.chance(0.12))
      addThought(edge, 'kindness', world.tick, { cause: emit(world, 'kindness', [a, b]) });
    else if (!positive && rng.chance(0.18))
      addThought(edge, 'slighted', world.tick, { cause: emit(world, 'dispute', [a, b]) });
  }

  promote(world, a, b, edge);            // marriage/feud/rivalry still emerge here
  if (tryMarry) attemptMarriage(world, a, b, edge); // explicit courting push
  if (edge.flags.feud && rng.chance(0.06)) brawl(world, a, b, edge);
}

function resolveGift(world: World, a: EntityId, b: EntityId): void {
  if (!isAlive(world, b)) return;
  const edge = getRel(world, a, b);
  addThought(edge, 'kindness', world.tick, { cause: emit(world, 'kindness', [a, b]) });
  promote(world, a, b, edge);
}

function resolveProvoke(world: World, a: EntityId, b: EntityId): void {
  if (!isAlive(world, b)) return;
  const edge = getRel(world, a, b);
  addThought(edge, 'slighted', world.tick, { cause: emit(world, 'dispute', [a, b]) });
  promote(world, a, b, edge);
}
```

`promote()` and `brawl()` are unchanged; `attemptMarriage` is the marriage half of
today's `promote` (the `eligibleToMarry`/`marry` path) exposed so `court` can
push for it directly.

---

## 5. Wiring it into the tick

`socialWeekly` becomes the **per-actor decision loop**. Crucially we keep the
single interleaved pass (decide-then-resolve per actor, in id order) rather than
two separate passes, so RNG-consumption order — and thus the determinism contract
— changes as little as possible:

```ts
// systems/social.ts  (now the "act" loop)
export function actWeekly(world: World): void {
  const adults = fullActors(world).filter((id) => isAdult(world, id));
  if (adults.length < 2) return;

  for (const a of adults) {
    if (!isAlive(world, a)) continue;
    const intent =
      a === world.playerId
        ? takePlayerIntent(world)   // buffered UI input (or { kind:'idle' })
        : decideActor(world, a);    // NPC producer
    resolveIntent(world, a, intent);
  }
}
```

`takePlayerIntent` pops the intent the UI buffered for this tick (defaulting to
`idle`) — see §6. **This `a === world.playerId` line is the entire player branch
in the simulation.** It selects an intent *source*; it does not alter any rule.

`needsDaily` drops to **pure metabolism** (decay only — no income, since income is
now the `work` action):

```ts
export function needsDaily(world: World): void {
  for (const id of fullActors(world)) {
    const n = world.needs.get(id)!;
    n.food = clamp(n.food - 6, 0, 1000);
    n.safety = clamp(n.safety - 1, 0, 1000);
    n.belonging = clamp(n.belonging - 2, 0, 1000);
  }
}
```

> **Tuning consequence:** moving income from daily-passive to weekly-`work`
> changes the food/wealth balance. The constants above (`+45` food, `×7` wealth
> per work) are first-cut; expect one balancing pass so populations stay stable.
> This *will* change the determinism hash — that's expected (see §7).

`sim.ts`'s `stepTick` only renames the weekly call (`socialWeekly` → `actWeekly`);
the cadence and ordering are untouched.

---

## 6. Determinism with a player in the loop

Three additions, each mirroring a pattern the engine already uses for the
director/geo/figure RNG streams.

**(a) A dedicated player RNG stream.** When the player's intent resolves, its
`rng.range`/`rng.chance` draws must **not** perturb the shared settlement stream
(or every player action silently reshuffles all later NPCs' histories that tick).
Resolve player actions against `world.playerRng` (seeded like the others):

```ts
playerId?: EntityId;
playerRngState: number; // mixSeed(seed, 0x91a) — independent stream
```

`resolveIntent` picks the stream by actor: `const rng = a === world.playerId ?
playerRng : world.rng;`. (This is the one extra player-aware line, and it lives in
*plumbing*, not in any rule's logic.)

**(b) An input log for replay.** Player choice is now part of world state, so the
world is `f(seed, playerInputs)`. Record every submitted intent:

```ts
playerInputs: { tick: number; intent: Intent }[];
```

Replay/load re-feeds these by tick; `takePlayerIntent` reads the entry whose
`tick === world.tick`. Append to `canonicalize()` so the hash covers them.

**(c) A determinism test variant.** Add to
[`sim.determinism.test.ts`](../poc/src/engine/sim.determinism.test.ts): run with a
fixed scripted `playerInputs` list twice → identical hash; and save→reload→replay
→ identical hash. The existing no-player test stays (now re-baselined).

---

## 7. What this step does and doesn't include

**In scope (this doc):** the `Intent` type, `decideActor`, `resolveIntent`/
`resolveWork`/`resolveInteract`/`resolveGift`/`resolveProvoke`, the `actWeekly`
loop, `needsDaily` reduced to metabolism, the player RNG stream + input log +
determinism test. After this, NPCs run entirely through intents — *with no player
yet*. That's the point: it's independently valuable (it's also the substrate for
emergent goals and state-driven Director incidents) and independently testable.

**Explicitly deferred to later player-as-actor steps (`02–06` cover these):**

- **Possession & pinned identity** — `possess(actorId)` sets `world.playerId` and
  marks the entity exempt from demotion. *Required guard:* in the demotion path in
  [`engine/lod.ts`](../poc/src/engine/lod.ts), never free the player entity
  (`if (id === world.playerId) continue`), so the player survives focus shifts and
  travel.
- **Control loop / protocol** — add `{ kind:'submitIntent'; intent }`,
  `{ kind:'advanceDays'; days }`, `{ kind:'possess'; actorId }` to
  [`worker/protocol.ts`](../poc/src/worker/protocol.ts); let the worker step and
  pause for input rather than only `advanceYears`.
- **`playerView` in the snapshot** — the player's needs, location, the actions
  available now, and nearby valid targets, so the UI can present choices.

None of items, religion, politics, economy depth, or packs are prerequisites.

---

## 8. Migration checklist (suggested order)

1. Add `engine/intent.ts` (`Intent` type). No behaviour change.
2. Create `systems/resolve.ts`; move `interact`→`resolveInteract` (+`bias`,
   `tryMarry`), `promote`/`brawl`/`marry`/`eligibleToMarry` over (or re-export).
3. Create `systems/decide.ts` (`decideActor`); export `choosePartner`.
4. Rewrite `socialWeekly`→`actWeekly` as the decide→resolve loop (NPC-only path
   first: no `playerId` yet, so the branch is dead — pure refactor).
5. Reduce `needsDaily` to metabolism; move income into `resolveWork`. **Balance.**
6. Re-baseline the no-player determinism hash; confirm the demo
   ([`narrative.demo.test.ts`](../poc/src/engine/narrative.demo.test.ts)) still
   reads well.
7. Add `playerRngState` / `playerInputs` / `playerId` to the `World` + `canonicalize`,
   then the scripted-input determinism test. (Player can't act yet, but the
   contract is now in place.)

Steps 1–6 are a behaviour-preserving (modulo balancing) refactor that ships value
on its own. Step 7 lays the determinism rails the rest of player-as-actor rides on.
