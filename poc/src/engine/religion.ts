/**
 * RELIGION — yearly faith dynamics.
 *
 * Runs once per year for the focused settlement. Three effects:
 *
 *   1. FAITH BONDS & FRICTION — co-religionists gradually warm to each other
 *      (faithBond thought); actors of different faiths develop mild friction
 *      (faithFriction thought). Uses a per-actor-per-year seeded sample of
 *      SAMPLE_N neighbours so it's O(n) not O(n²) and stays deterministic.
 *
 *   2. CONVERSION — faithless actors have a small yearly chance to find faith
 *      in the settlement's patron deity, scaling up when the community is
 *      predominantly faithful (social pressure converts).
 *
 *   3. APOSTASY (spontaneous) — faithful actors have a very small yearly chance
 *      of a private crisis of faith. The larger, event-driven path (public
 *      condemnation → apostasy roll) lives in perception.ts.
 *
 * All rolls use independent per-actor-per-year seeded RNG streams so no call
 * here ever advances the shared settlement RNG — NPC outcomes are byte-identical
 * regardless of faith dynamics.
 */
import { type World, type EntityId } from './model';
import { fullActors, getRel, emit, isWed } from './world';
import { addThought } from './opinion';
import { addSelfThought } from './mood';
import { standingOf } from './reputation';
import { Rng, mixSeed } from './rng';
import { patronDeityOf, deityById, cultureById, elderhoodOf, WEALTH_NEED, type ActorLifeState } from './pack';

/** Neighbours each faithful actor samples per year for faith affinity thoughts. */
const SAMPLE_N = 4;
/** Faithless baseline yearly conversion chance. */
const CONVERT_BASE = 0.02;
/** Added to conversion chance when ≥75 % of the settlement is already faithful. */
const CONVERT_SOCIAL = 0.06;
/** Faithful baseline yearly spontaneous apostasy chance (very rare). */
const APOSTATE_CHANCE = 0.005;

/** Gather how an actor is LIVING — the pure snapshot a state precept judges (mood.ts).
 *  Kept in the engine (it reads the standing reducer, ties, lifecycle) so pack predicates
 *  stay pure over primitives. */
function buildLifeState(world: World, id: EntityId): ActorLifeState {
  const lc = world.lifecycle.get(id)!;
  const speciesId = world.identity.get(id)!.speciesId;
  return {
    wealth: world.needs.get(id)?.[WEALTH_NEED] ?? 500,
    standing: standingOf(world, id),
    ageYears: lc.ageYears,
    children: world.ties.get(id)?.children.length ?? 0,
    wed: isWed(world, id),
    isElder: lc.ageYears >= elderhoodOf(speciesId),
  };
}

/**
 * STATE PRECEPTS (design/23 Stage 3) — the creed's yearly judgement on how each resident
 * LIVES. For every full actor, any of their culture's state precepts whose condition holds
 * lays an ongoing self-thought (at_peace / disquiet) on their mood; sacred ones weigh only
 * on the faithful. Renewed each year, so the mood persists while the life-state does and
 * fades once it changes. RNG-free — a pure function of state, safe for determinism.
 */
export function statePreceptsYearly(world: World): void {
  const cultureId = world.settlements[world.focusedSettlementId]?.cultureId ?? '';
  const culture = cultureById(cultureId);
  const rules = culture.statePrecepts;
  if (!rules || rules.length === 0) return;
  const patron = patronDeityOf(cultureId).id;

  for (const id of fullActors(world)) {
    const faithful = world.faith.get(id) === patron;
    let state: ActorLifeState | undefined;
    for (const p of rules) {
      if (p.sacred && !faithful) continue; // sacred ways of living weigh only on adherents
      state ??= buildLifeState(world, id); // built once per actor, only if a precept applies
      if (p.holds(state)) addSelfThought(world, id, p.self);
    }
  }
}

export function religionYearly(world: World): void {
  const residents = fullActors(world);
  if (residents.length < 2) return;
  const n = residents.length;
  const cultureId = world.settlements[world.focusedSettlementId]?.cultureId ?? '';

  // ---- faith bonds & friction ----
  // Each faithful actor samples SAMPLE_N random co-residents. Shared faith adds a
  // faithBond thought (renews annually while they share a home); different faith adds
  // faithFriction. Both expire after two years, so movement ends the effect naturally.
  for (const id of residents) {
    const myFaith = world.faith.get(id) ?? '';
    if (!myFaith) continue;
    const rng = new Rng(mixSeed(world.seed, id, world.tick ^ 0xfa1b));
    for (let k = 0; k < SAMPLE_N; k++) {
      const otherId = residents[rng.int(n)];
      if (otherId === id) continue;
      const otherFaith = world.faith.get(otherId) ?? '';
      if (!otherFaith) continue;
      addThought(getRel(world, id, otherId), myFaith === otherFaith ? 'faithBond' : 'faithFriction', world.tick, {});
    }
  }

  if (!cultureId) return;
  const patron = patronDeityOf(cultureId);
  const faithfulCount = residents.filter((r) => world.faith.get(r) === patron.id).length;
  const faithfulFraction = faithfulCount / n;

  // ---- conversion & apostasy ----
  for (const id of residents) {
    const faith = world.faith.get(id) ?? '';
    const rng = new Rng(mixSeed(world.seed, id, world.tick ^ 0xfe17));

    if (!faith) {
      // Faithless: chance to adopt the settlement's patron deity, amplified when the
      // community is predominantly faithful (social pressure as a conversion force).
      const chance = CONVERT_BASE + (faithfulFraction >= 0.75 ? CONVERT_SOCIAL : 0);
      if (rng.chance(chance)) {
        world.faith.set(id, patron.id);
        emit(world, 'converted', [id], { deity: patron.name });
      }
    } else {
      // Faithful: very small chance of a spontaneous, private crisis of faith.
      if (rng.chance(APOSTATE_CHANCE)) {
        world.faith.set(id, '');
        emit(world, 'apostasy', [id], { deity: deityById(faith).name });
      }
    }
  }
}
