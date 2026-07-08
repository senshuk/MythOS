/**
 * Ambitions are the player's self-chosen, long-horizon goal — these pin that offers come from the
 * actor's real situation, that committing is validated, that the next step is a gap-derived
 * decision, that an ambition RESOLVES (fulfilled when the deed is done, thwarted when it becomes
 * impossible rather than leaving the player stuck), and — the load-bearing safety property —
 * that committing to one never touches the simulation hash.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorld,
  runYears,
  possess,
  hashWorld,
  chooseAmbition,
  abandonAmbition,
  reviewPlayerAmbition,
} from './sim';
import { offerableAmbitions, buildAmbitionView } from './ambition';
import { serializeWorld, deserializeWorld } from './persistence';
import { fullActors, getRel } from './world';
import { addThought } from './opinion';

/** A world with a possessed player who holds an open feud with a living neighbour. */
function feuding(seed: number, years = 8): { w: ReturnType<typeof createWorld>; player: number; foe: number } {
  const w = createWorld(seed);
  runYears(w, years);
  const actors = fullActors(w);
  const player = actors[0];
  const foe = actors.find((a) => a !== player && w.lifecycle.get(a)!.alive)!;
  possess(w, player);
  const edge = getRel(w, player, foe);
  for (let i = 0; i < 4; i++) addThought(edge, 'slighted', w.tick); // sour it well below zero
  edge.flags.feud = true;
  return { w, player, foe };
}

describe('ambitions', () => {
  it('offers a feuding player the chance to best their rival', () => {
    const { w, player, foe } = feuding(1);
    const offers = offerableAmbitions(w, player);
    const rival = offers.find((o) => o.id === 'rival');
    expect(rival).toBeDefined();
    expect(rival!.target).toBe(foe);
    expect(rival!.targetName).toBeTruthy();
  });

  it('commits only to an ambition the situation actually supports', () => {
    const { w, player, foe } = feuding(2);
    expect(chooseAmbition(w, player, 'rival', foe)).toBe(true);
    expect(w.playerAmbition?.id).toBe('rival');
    expect(w.playerAmbition?.target).toBe(foe);
    // an ambition the engine has never heard of is refused
    expect(chooseAmbition(w, player, 'colonize_mars')).toBe(false);
  });

  it('surfaces a gap-derived next step as a decision', () => {
    const { w, player, foe } = feuding(3);
    chooseAmbition(w, player, 'rival', foe);
    const view = buildAmbitionView(w, player);
    expect(view.ambition?.id).toBe('rival');
    expect(view.ambition?.step).toBeDefined();
    const kinds = view.ambition!.step!.options.map((o) => o.intent.kind);
    expect(kinds).toContain('provoke'); // confront
    expect(kinds).toContain('work'); // outshine
    expect(view.offered).toHaveLength(0); // one ambition at a time while it's live
  });

  it('resolves as FULFILLED when the deed is done, then offers fresh ambitions', () => {
    const { w, player, foe } = feuding(4);
    chooseAmbition(w, player, 'rival', foe);
    reviewPlayerAmbition(w);
    expect(w.playerAmbition?.completedTick).toBeUndefined(); // not yet

    w.lifecycle.get(foe)!.alive = false; // the rival falls — you outlasted them
    reviewPlayerAmbition(w);
    expect(w.playerAmbition?.outcome).toBe('fulfilled');
    expect(w.playerAmbition?.completedTick).toBe(w.tick);

    const view = buildAmbitionView(w, player);
    expect(view.ambition?.outcome).toBe('fulfilled');
    expect(view.ambition?.step).toBeUndefined(); // nothing left to pursue
    // resolved → the player is offered a new direction, never left adrift
  });

  it('resolves as THWARTED (not stuck) when an ambition becomes impossible', () => {
    // testing reviewPlayerAmbition's thwart path directly (chooseAmbition's offer-gating is covered
    // above) — install a 'marry' ambition, then let the prospect wed someone else. Cheap + stable:
    // no 30-year sim + prospect-search (that was flaky against the default test timeout).
    const { w, player, foe: prospect } = feuding(11);
    w.playerAmbition = { id: 'marry', target: prospect, chosenTick: w.tick };

    const third = fullActors(w).find((a) => a !== player && a !== prospect)!;
    w.ties.get(prospect)!.spouses.push(third); // the prospect weds another — no longer reachable
    reviewPlayerAmbition(w);
    expect(w.playerAmbition?.outcome).toBe('thwarted');
  });

  it('abandoning an ambition clears it', () => {
    const { w, player, foe } = feuding(6);
    chooseAmbition(w, player, 'rival', foe);
    abandonAmbition(w);
    expect(w.playerAmbition).toBeUndefined();
    expect(buildAmbitionView(w, player).ambition).toBeUndefined();
  });

  it('committing to an ambition never perturbs the simulation hash (steering state, not world state)', () => {
    const { w, player, foe } = feuding(7);
    const before = hashWorld(w);
    chooseAmbition(w, player, 'rival', foe);
    reviewPlayerAmbition(w);
    buildAmbitionView(w, player);
    expect(hashWorld(w)).toBe(before);
  });

  it('a committed ambition survives save/load ("the save file is the world")', () => {
    const { w, player, foe } = feuding(8);
    chooseAmbition(w, player, 'rival', foe);
    const loaded = deserializeWorld(serializeWorld(w));
    expect(loaded.playerAmbition).toEqual(w.playerAmbition);
  });
});
