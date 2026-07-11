/**
 * VENUES (design/25) — the Location tree's first sim meaning. These tests pin the
 * ADR's laws: minting is idempotent and stream-free, venue choice is a pure hash
 * that perturbs no dice, social outcomes carry their venue, prose links it, the
 * inspector answers "what happened here", and saves round-trip it all.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, inspectVenue } from './sim';
import { ensureVenues, pickVenue } from './venues';
import { getChildren } from './location';
import { renderEventParts } from './render';
import { serializeWorld, deserializeWorld } from './persistence';

// ONE shared world fixture (test-suite convention): a focused town with some life run
const W = createWorld(123456);
runYears(W, 6);
const SID = W.focusedSettlementId;
const S = W.settlements[SID];

describe('minting (promote → venues)', () => {
  it('the focused settlement raised its venues', () => {
    const types = getChildren(W, SID).map((c) => c.locationType);
    expect(types).toContain('square');
    expect(types).toContain('shrine');
    expect(types).toContain('tavern'); // the fixture town is well over 100 souls
  });

  it('is idempotent and stream-free', () => {
    const before = getChildren(W, SID).length;
    const rngBefore = W.rng.state;
    ensureVenues(W, S);
    ensureVenues(W, S);
    expect(getChildren(W, SID).length).toBe(before);
    expect(W.rng.state).toBe(rngBefore); // THE LAW: minting never touches the stream
  });

  it('a macro settlement has none (only the lived-in-full town mints)', () => {
    const other = W.settlements.find((s) => s.id !== SID && s.ruinedYear === undefined)!;
    expect(getChildren(W, other.id).length).toBe(0);
  });
});

describe('venue choice (pure hash, pack preference order)', () => {
  it('is deterministic and stream-free', () => {
    const rngBefore = W.rng.state;
    const locals = [...W.homeSettlement.entries()].filter(([, s]) => s === SID).map(([a]) => a);
    const a = locals[0];
    const b = locals[1];
    expect(pickVenue(W, 'married', a, b)).toEqual(pickVenue(W, 'married', a, b));
    expect(W.rng.state).toBe(rngBefore);
  });

  it('a wedding prefers the shrine; an unlocated type returns undefined', () => {
    const locals = [...W.homeSettlement.entries()].filter(([, s]) => s === SID).map(([a]) => a);
    const v = pickVenue(W, 'married', locals[0], locals[1]);
    expect(v).toBeDefined();
    const shrine = getChildren(W, SID).find((c) => c.locationType === 'shrine')!;
    expect(v!.venueId).toBe(shrine.id);
    expect(pickVenue(W, 'settlement_founded', locals[0], locals[1])).toBeUndefined();
  });
});

describe('located outcomes', () => {
  // six lived years produce weddings/friendships/brawls in a 350-soul town
  const located = W.events.filter((ev) => typeof ev.data.venueId === 'number');

  it('social events carry their venue', () => {
    expect(located.length).toBeGreaterThan(0);
    for (const ev of located.slice(0, 10)) {
      expect(['married', 'friendship', 'brawl', 'died_brawl', 'feud']).toContain(ev.type);
      expect(W.locations.get(ev.data.venueId as number)).toBeDefined();
    }
  });

  it('the prose names the venue and links it (kind: venue)', () => {
    const ev = located[0];
    const parts = renderEventParts(W, ev);
    const venuePart = parts.find((p) => p.ref?.kind === 'venue');
    expect(venuePart).toBeDefined();
    expect(venuePart!.text).toBe(ev.data.venue);
  });

  it('the venue inspector answers "what happened here"', () => {
    // newest located event — the inspector lists newest-first, capped at 40
    const ev = located[located.length - 1];
    const detail = inspectVenue(W, ev.data.venueId as number)!;
    expect(detail).toBeDefined();
    expect(detail.settlementId).toBe(SID);
    expect(detail.events.some((e) => e.id === ev.id)).toBe(true);
  });
});

describe('persistence', () => {
  it('venues and located events round-trip byte-identically', () => {
    const restored = deserializeWorld(serializeWorld(W));
    const before = getChildren(W, SID).map((c) => `${c.id}:${c.locationType}:${c.name}`);
    const after = getChildren(restored, SID).map((c) => `${c.id}:${c.locationType}:${c.name}`);
    expect(after).toEqual(before);
    // and the lazy-upgrade hook adds nothing to an already-minted town
    ensureVenues(restored, restored.settlements[SID]);
    expect(getChildren(restored, SID).length).toBe(before.length);
  });
});
