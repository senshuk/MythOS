/**
 * Substrate tests for mark.ts — lifecycle ONLY. These deliberately speak no domain
 * vocabulary (no opinions, no reputation, no belief). If a test here needs to know what
 * a mark *means*, it belongs in a domain test file, not this one.
 */
import { describe, it, expect } from 'vitest';
import { type Mark } from './model';
import { isActive, activeMarks, dropExpired, indexByKind } from './mark';

/** A bare mark with just the lifecycle fields — the substrate sees nothing more. */
function mark(kind: string, sinceTick: number, expiresTick?: number): Mark {
  return { kind, sinceTick, expiresTick };
}

describe('mark substrate — isActive', () => {
  it('a permanent mark (no expiry) is always active', () => {
    expect(isActive(mark('k', 0), 0)).toBe(true);
    expect(isActive(mark('k', 0), 1_000_000)).toBe(true);
  });

  it('expiry is a strict future boundary: active while expiresTick > tick', () => {
    const m = mark('k', 0, 10);
    expect(isActive(m, 9)).toBe(true);
    expect(isActive(m, 10)).toBe(false); // expires AT its expiry tick, not after
    expect(isActive(m, 11)).toBe(false);
  });
});

describe('mark substrate — activeMarks', () => {
  it('returns only active marks, preserving input order', () => {
    const marks = [mark('a', 0, 5), mark('b', 1), mark('c', 2, 5), mark('d', 3, 20)];
    const active = activeMarks(marks, 5); // 'a' and 'c' expire exactly at 5
    expect(active.map((m) => m.kind)).toEqual(['b', 'd']);
  });

  it('does not mutate the input array', () => {
    const marks = [mark('a', 0, 1), mark('b', 1)];
    activeMarks(marks, 5);
    expect(marks).toHaveLength(2);
  });
});

describe('mark substrate — dropExpired', () => {
  it('removes expired marks', () => {
    const marks = [mark('a', 0, 1), mark('b', 1), mark('c', 2, 1)];
    expect(dropExpired(marks, 5).map((m) => m.kind)).toEqual(['b']);
  });

  it('returns the SAME array reference when nothing expired (no needless allocation)', () => {
    const marks = [mark('a', 0), mark('b', 1, 100)];
    expect(dropExpired(marks, 5)).toBe(marks); // identity, not just equality
  });

  it('returns a NEW array when something expired', () => {
    const marks = [mark('a', 0, 1), mark('b', 1)];
    expect(dropExpired(marks, 5)).not.toBe(marks);
  });
});

describe('mark substrate — indexByKind', () => {
  it('buckets marks by kind, preserving order within each bucket', () => {
    const a1 = mark('a', 0);
    const b1 = mark('b', 1);
    const a2 = mark('a', 2);
    const idx = indexByKind([a1, b1, a2]);
    expect([...idx.keys()]).toEqual(['a', 'b']); // insertion order of kinds
    expect(idx.get('a')).toEqual([a1, a2]); // order within a kind preserved
    expect(idx.get('b')).toEqual([b1]);
  });

  it('yields an empty index for no marks', () => {
    expect(indexByKind([]).size).toBe(0);
  });
});
