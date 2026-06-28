/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, setStoryteller, hashWorld, possess } from './sim';
import { fullActors } from './world';
import { hasLeader } from '../content/fixture';

describe('director (storyteller)', () => {
  it('fires incidents that the world remembers, each emitting one summary event', () => {
    const w = createWorld(42);
    runYears(w, 60);
    expect(w.director.incidents).toBeGreaterThan(0);
    const directorTypes = new Set(['boon', 'blight', 'plague', 'wonder', 'beast', 'omen']);
    const incidentEvents = w.events.filter((e) => directorTypes.has(e.type));
    expect(incidentEvents.length).toBe(w.director.incidents);
  });

  it('personality changes how much drama is injected (grim > gentle)', () => {
    const incidents = (p: string) => {
      const w = createWorld(7);
      setStoryteller(w, p);
      runYears(w, 60);
      return w.director.incidents;
    };
    expect(incidents('grim')).toBeGreaterThan(incidents('gentle'));
  });

  it('is deterministic, including the choice of storyteller', () => {
    const run = (p: string) => {
      const w = createWorld(99);
      setStoryteller(w, p);
      runYears(w, 50);
      return hashWorld(w);
    };
    expect(run('grim')).toBe(run('grim')); // reproducible
    expect(run('grim')).not.toBe(run('gentle')); // a different storyteller => a different world
  });
});

describe('audit fixes', () => {
  it('the player is never involuntarily emigrated out of the focused settlement', () => {
    const w = createWorld(2024);
    runYears(w, 5);
    const young = fullActors(w).find((i) => {
      const a = w.lifecycle.get(i)!.ageYears;
      return a >= 18 && a <= 30;
    })!;
    possess(w, young);
    runYears(w, 25); // migration fires yearly; without the guard the player could be moved
    if (w.lifecycle.get(young)!.alive) {
      expect(w.fidelity.get(young)).toBe('full');
      expect(w.homeSettlement.get(young)).toBe(w.focusedSettlementId);
    }
  });

  it('rule passes to a real local heir in the focused settlement (an actor can rise to rule)', () => {
    // across a few worlds, find one whose focused settlement HAS a leadership seat, run it long
    // enough for a succession, and confirm a SIMULATED ACTOR (not a minted stranger) rose to rule.
    let sawActorRuler = false;
    for (let seed = 2024; seed < 2040 && !sawActorRuler; seed++) {
      const w = createWorld(seed);
      const fid = w.focusedSettlementId;
      if (!hasLeader(w.settlements[fid].governmentId)) continue; // leaderless polity — no ruler to rise to
      runYears(w, 90);
      const rulerId = w.settlements[fid].currentRulerId;
      if (
        rulerId !== undefined &&
        w.identity.has(rulerId) && // a simulated actor, not a minted stranger
        w.figures.some((f) => f.id === rulerId && f.role === 'ruler')
      ) {
        sawActorRuler = true;
      }
    }
    expect(sawActorRuler).toBe(true);
  });
});
