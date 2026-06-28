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
import { type World, type FactionSplit, type EntityId } from './model';
import { fullActors, getRel } from './world';
import { addThought } from './opinion';
import { Rng, mixSeed } from './rng';
import { VALUES, type ValueAxis, factionNames } from '../content/fixture';

const SAMPLE_N = 3; // opposing-faction neighbor samples per actor per year
const MIN_ACTORS = 20; // minimum settlement size for a split to be meaningful

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
