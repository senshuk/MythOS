/**
 * Deterministic seeded PRNG (mulberry32).
 *
 * The ENTIRE simulation draws randomness from one of these, advanced in a fixed
 * order. This is the foundation of MythOS determinism: same seed + same code =>
 * byte-identical world. Sim code must NEVER call Math.random() or Date.now().
 *
 * mulberry32 uses only integer ops (Math.imul) + a single float division, so it
 * is reproducible across machines/browsers.
 */
/**
 * Deterministically derive a uint32 seed from a set of integers (FNV-1a over the
 * bytes). Used to give each settlement its own independent, reproducible RNG
 * stream from the single world seed — the basis of locality-independent LOD.
 */
export function mixSeed(...nums: number[]): number {
  let h = 0x811c9dc5 >>> 0;
  for (const num of nums) {
    let x = num >>> 0;
    for (let b = 0; b < 4; b++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      x >>>= 8;
    }
  }
  return h >>> 0;
}

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, maxInclusive]. */
  range(min: number, maxInclusive: number): number {
    return min + this.int(maxInclusive - min + 1);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly pick one element. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Pick an index by weights (weights need not sum to 1). */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Serialize the cursor (for snapshots / determinism checks). */
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }
}
