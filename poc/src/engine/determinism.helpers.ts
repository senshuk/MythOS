/**
 * Shared fixtures for the determinism test suite. The suite is split across several
 * `*.determinism.*.test.ts` files so vitest's worker pool runs them in PARALLEL (one
 * file = one worker) instead of serially in a single thread — the suite is CPU-bound
 * on many multi-decade simulations, so this is a large wall-clock win on a multi-core
 * box. The scripted scenarios that more than one of those files needs live here.
 *
 * These are verbatim copies of the helpers that previously sat at the top of the
 * monolithic determinism test file — behaviour is unchanged.
 */
import { createWorld, runYears, focusSettlement, possess, schedulePlayerIntent } from './sim';
import { fullActors } from './world';
import { SurfaceSubstrate } from './substrate';
import { DAYS_PER_YEAR, ADULT_AGE, type World } from './model';
import { type Intent } from './intent';

/** The surface geography of a land world (only valid when substrate.kind === 'surface'). */
export const geoOf = (w: World) => (w.substrate as SurfaceSubstrate).geography;

/** A fixed session: advance, shift focus across settlements, advance again. */
export function scriptedRun(seed: number): World {
  const w = createWorld(seed);
  runYears(w, 20);
  focusSettlement(w, 3);
  runYears(w, 20);
  focusSettlement(w, 7);
  runYears(w, 20);
  focusSettlement(w, 1);
  runYears(w, 15);
  return w;
}

/** First two living adults of the focused settlement: the player and a target. */
export function pickPlayerAndTarget(w: World): { player: number; target: number } {
  const adults = fullActors(w).filter(
    (id) => w.lifecycle.get(id)!.alive && w.lifecycle.get(id)!.ageYears >= ADULT_AGE,
  );
  return { player: adults[0], target: adults[adults.length - 1] };
}

/** A scripted player session: possess an adult and feed a fixed sequence of intents at
 *  every weekly act tick for 5 years. With `act = false` the player is possessed but
 *  only idles, so the world differs only by the player's actions. */
export function playerRun(seed: number, act: boolean): World {
  const w = createWorld(seed);
  const { player, target } = pickPlayerAndTarget(w);
  possess(w, player);
  if (act) {
    for (let tick = 7; tick <= 5 * DAYS_PER_YEAR; tick += 7) {
      const k = (tick / 7) % 4;
      const intent: Intent =
        k === 0
          ? { kind: 'give', target }
          : k === 1
            ? { kind: 'socialize', target }
            : k === 2
              ? { kind: 'court', target }
              : { kind: 'work' };
      schedulePlayerIntent(w, tick, intent);
    }
  }
  runYears(w, 5);
  return w;
}
