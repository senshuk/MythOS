/**
 * One substrate per seed, shared by every view that needs it (the world map and the
 * close view both re-derive presentation-side — design/24 §2). Generating a 450²
 * geography isn't free, so mounting a second view must not pay it again.
 */
import { createSubstrate, type Substrate } from '../engine/substrate';

const cache = new Map<number, Substrate>();

export function substrateFor(seed: number): Substrate {
  let s = cache.get(seed);
  if (!s) {
    s = createSubstrate(seed);
    cache.set(seed, s);
    // keep the couple most recent worlds (reforging with a new seed drops the old)
    if (cache.size > 2) cache.delete(cache.keys().next().value!);
  }
  return s;
}
