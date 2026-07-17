/**
 * Intra-cultural factionalism.
 *
 * Every community of meaningful size is internally divided. The contested axis is the
 * value dimension (war, tradition, honor, …) on which residents disagree the most —
 * measured as the spread between the high-third and low-third of the population's value
 * distribution. No threshold: the split is always active for settlements ≥ MIN_ACTORS;
 * the contested axis shifts as the population changes.
 *
 * Produces:
 *   - world.factionSplit  — which axis, faction names, leaders, cached mean
 *   - factionRivalry thoughts between opposing-pole residents (sampled, O(n))
 *   - contested_succession events (emitted by figures.ts when power changes hands)
 *
 * factionYearly must run BEFORE figuresYearly so the split is fresh when the
 * succession check reads it.
 */
import { type World, type FactionSplit, type EntityId, type Settlement, type SettlementId, DAYS_PER_YEAR } from './model';
import { fullActors, getRel, emit } from './world';
import { addThought } from './opinion';
import { Rng, mixSeed } from './rng';
import { VALUES, type ValueAxis, factionNames } from './pack';
import { perceiveEvent } from './perception';

const SAMPLE_N = 3; // opposing-faction neighbor samples per actor per year
const MIN_ACTORS = 20; // minimum settlement size for a split to be meaningful
const CIVIL_WAR_GRACE_YEARS = 10; // years of simmering tension before war erupts
export const EXILE_RETURN_YEARS = 20; // years in exile before a formal return attempt

function detectSplit(world: World): FactionSplit | undefined {
  const residents = fullActors(world);
  if (residents.length < MIN_ACTORS) return undefined;

  const n = residents.length;
  let bestAxis: ValueAxis | null = null;
  let bestSpread = 0;
  let bestMean = 0;

  for (const axis of VALUES) {
    const vals = residents.map((id) => world.personality.get(id)?.values[axis] ?? 0);
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const sorted = [...vals].sort((a, b) => a - b);
    const third = Math.floor(n / 3);
    const lowMean = sorted.slice(0, third).reduce((a, b) => a + b, 0) / third;
    const highMean = sorted.slice(n - third).reduce((a, b) => a + b, 0) / third;
    const spread = highMean - lowMean;
    if (spread > bestSpread) {
      bestSpread = spread;
      bestAxis = axis;
      bestMean = mean;
    }
  }

  if (!bestAxis) return undefined;

  const ax = bestAxis;
  const [highName, lowName] = factionNames(ax);

  const sortedActors = [...residents].sort(
    (a, b) => (world.personality.get(b)?.values[ax] ?? 0) - (world.personality.get(a)?.values[ax] ?? 0),
  );

  return {
    axis: ax,
    highName,
    lowName,
    highLeaderId: sortedActors[0],
    lowLeaderId: sortedActors[sortedActors.length - 1],
    axisMean: bestMean,
  };
}

/** Which faction pole this actor belongs to: 'high' (pro-axis) or 'low' (anti-axis).
 *  Returns undefined if no split is active or the actor has no personality record. */
export function factionOf(world: World, id: EntityId): 'high' | 'low' | undefined {
  const split = world.factionSplit;
  if (!split) return undefined;
  const pers = world.personality.get(id);
  if (!pers) return undefined;
  return (pers.values[split.axis as ValueAxis] ?? 0) >= split.axisMean ? 'high' : 'low';
}

/** Mark the settlement's civil war clock — called by figures.ts when a
 *  contested_succession fires. Only sets it once (a second contested succession
 *  while a clock is already running does not reset the countdown). */
export function startCivilWarClock(world: World, s: Settlement, causeEv?: number): void {
  if (s.civilWarTick === undefined && world.tick > 0) {
    s.civilWarTick = world.tick;
    s.civilWarCause = causeEv; // the contested succession, so the war can trace its "why?"
  }
}

/** Nearest live (non-ruined) settlement that isn't fromId, for exile routing. */
function pickExileDestination(world: World, fromId: SettlementId): SettlementId | undefined {
  let best: SettlementId | undefined;
  let bestDist = Infinity;
  for (const edge of world.edges) {
    const other = edge.a === fromId ? edge.b : edge.b === fromId ? edge.a : undefined;
    if (other === undefined || other === fromId) continue;
    if (world.settlements[other]?.ruinedYear !== undefined) continue;
    if (edge.distance < bestDist) { bestDist = edge.distance; best = other; }
  }
  return best;
}

/** Yearly: resolve a civil war if CIVIL_WAR_GRACE_YEARS have passed since the
 *  contested succession that started the clock. The larger faction wins; the losing
 *  faction leader is expelled (exile event + world.exiles record). Runs AFTER
 *  figuresYearly so the succession itself is already recorded this turn. */
export function civilWarYearly(world: World): void {
  const focused = world.settlements[world.focusedSettlementId];
  if (!focused || focused.civilWarTick === undefined) return;

  const yearsSince = (world.tick - focused.civilWarTick) / DAYS_PER_YEAR;
  if (yearsSince < CIVIL_WAR_GRACE_YEARS) return;

  // If the split has dissolved (tiny or uniform population), cancel peacefully.
  const split = world.factionSplit;
  if (!split) { focused.civilWarTick = undefined; focused.civilWarCause = undefined; return; }

  const year = Math.floor(world.tick / DAYS_PER_YEAR);
  const residents = fullActors(world);
  let highCount = 0, lowCount = 0;
  let highTotal = 0, lowTotal = 0;
  for (const id of residents) {
    const pole = factionOf(world, id);
    if (!pole) continue;
    const val = world.personality.get(id)?.values[split.axis as ValueAxis] ?? 0;
    if (pole === 'high') { highCount++; highTotal += val; }
    else { lowCount++; lowTotal += val; }
  }

  const highWins = highCount > lowCount || (highCount === lowCount && highTotal > lowTotal);
  const winnerName = highWins ? split.highName : split.lowName;
  const loserName  = highWins ? split.lowName  : split.highName;
  const loserLeaderId = highWins ? split.lowLeaderId : split.highLeaderId;

  const warEvId = emit(world, 'civil_war', [], {
    settlement: focused.name,
    winner: winnerName,
    loser: loserName,
    axis: split.axis,
  }, focused.civilWarCause !== undefined ? [focused.civilWarCause] : [], [focused.id]);

  // Expel the losing faction leader if they are a real (simulated) actor.
  if (loserLeaderId !== undefined && world.identity.has(loserLeaderId)) {
    const dest = pickExileDestination(world, focused.id);
    if (dest !== undefined) {
      world.exiles.set(loserLeaderId, {
        fromSettlementId: focused.id,
        axis: split.axis,
        factionName: loserName,
        year,
      });
      // move to destination as a summary actor
      world.fidelity.set(loserLeaderId, 'summary');
      world.homeSettlement.set(loserLeaderId, dest);
      world.settlements[dest].macro.population += 1;
      const exileId = emit(world, 'exile', [loserLeaderId], {
        from: focused.name,
        to: world.settlements[dest].name,
        faction: loserName,
        axis: split.axis,
      }, [warEvId], [focused.id, dest]);
      // the town watches its loser cast out — the one public fact from which, in time, folk
      // will invent a reason (Legend Drift: `exiled` → cast out for witchcraft, fled in the
      // night, went willingly…). Witnessed HERE, where it happened, not at the destination.
      perceiveEvent(world, exileId, focused.id);
    }
  }

  focused.civilWarTick = undefined;
  focused.civilWarCause = undefined;
}

/** Yearly: check all pending exiles. After EXILE_RETURN_YEARS the actor returns to the
 *  focused settlement via a formal return_from_exile event (not via normal migration).
 *  Dead exiles are pruned from world.exiles. Runs AFTER civilWarYearly. */
export function exileYearly(world: World): void {
  if (world.exiles.size === 0) return;
  const focused = world.settlements[world.focusedSettlementId];
  if (!focused) return;
  const currentYear = Math.floor(world.tick / DAYS_PER_YEAR);

  for (const [id, rec] of world.exiles) {
    if (rec.fromSettlementId !== world.focusedSettlementId) continue;

    const lc = world.lifecycle.get(id);
    if (!lc || !lc.alive) { world.exiles.delete(id); continue; } // died in exile

    if (currentYear - rec.year < EXILE_RETURN_YEARS) continue;

    // Formal return: move back to the focused settlement regardless of current home.
    const currentHome = world.homeSettlement.get(id);
    if (currentHome !== undefined && currentHome !== world.focusedSettlementId) {
      world.settlements[currentHome].macro.population = Math.max(0, world.settlements[currentHome].macro.population - 1);
    }
    world.fidelity.set(id, 'full');
    world.homeSettlement.set(id, world.focusedSettlementId);
    emit(world, 'return_from_exile', [id], {
      settlement: focused.name,
      faction: rec.factionName,
      axis: rec.axis,
      yearsGone: currentYear - rec.year,
    }, [], [world.focusedSettlementId]);
    world.exiles.delete(id);
  }
}

/** Yearly: recompute the contested split and add factionRivalry thoughts between
 *  residents on opposing poles (sampled, not O(n²)). Must run before figuresYearly. */
export function factionYearly(world: World): void {
  world.factionSplit = detectSplit(world);
  if (!world.factionSplit) return;

  const split = world.factionSplit;
  const residents = fullActors(world);
  const n = residents.length;

  for (const id of residents) {
    const myHigh = (world.personality.get(id)?.values[split.axis as ValueAxis] ?? 0) >= split.axisMean;
    const rng = new Rng(mixSeed(world.seed, id, world.tick ^ 0xfac1));
    for (let k = 0; k < SAMPLE_N; k++) {
      const otherId = residents[rng.int(n)];
      if (otherId === id) continue;
      const otherHigh =
        (world.personality.get(otherId)?.values[split.axis as ValueAxis] ?? 0) >= split.axisMean;
      if (myHigh !== otherHigh) {
        addThought(getRel(world, id, otherId), 'factionRivalry', world.tick, {});
      }
    }
  }
}
