/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless, hashWorld, canonicalize, createWorld, runYears, possess } from './sim';
import { resolvePlayerIntent } from '../systems/resolve';
import { scriptedRun, playerRun, pickPlayerAndTarget } from './determinism.helpers';

describe('determinism', () => {
  it('two runs with the same seed produce identical worlds', () => {
    const a = runHeadless(123456, 60);
    const b = runHeadless(123456, 60);
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('a scripted session with focus changes is fully reproducible', () => {
    expect(hashWorld(scriptedRun(31337))).toBe(hashWorld(scriptedRun(31337)));
    expect(canonicalize(scriptedRun(42))).toBe(canonicalize(scriptedRun(42)));
  });
});

describe('player-as-actor (determinism rails)', () => {
  it('a scripted player session is fully reproducible', () => {
    expect(hashWorld(playerRun(99, true))).toBe(hashWorld(playerRun(99, true)));
    expect(canonicalize(playerRun(42, true))).toBe(canonicalize(playerRun(42, true)));
  });

  it('re-feeding the recorded input log reconstructs the world (replay)', () => {
    const live = playerRun(99, true);

    // a fresh world, same possession, fed ONLY the recorded input log, reproduces
    // the exact same world — proving the log is sufficient player state for replay.
    const replay = createWorld(99);
    const { player } = pickPlayerAndTarget(replay);
    possess(replay, player);
    replay.playerInputs = live.playerInputs.map((e) => ({ ...e }));
    runYears(replay, 5);

    expect(hashWorld(replay)).toBe(hashWorld(live));
  });

  it('the player actually changes history (inputs matter)', () => {
    expect(hashWorld(playerRun(99, true))).not.toBe(hashWorld(playerRun(99, false)));
  });

  it("the player's randomness is isolated from the NPC stream", () => {
    const w = createWorld(7);
    runYears(w, 2); // populate adult relationships
    const { player, target } = pickPlayerAndTarget(w);
    possess(w, player);

    const worldRngBefore = w.rng.state;
    const playerRngBefore = w.playerRngState;
    resolvePlayerIntent(w, player, { kind: 'socialize', target });

    expect(w.rng.state).toBe(worldRngBefore); // shared settlement stream untouched
    expect(w.playerRngState).not.toBe(playerRngBefore); // player stream advanced
  });
});
