/**
 * A COMMONER'S TURNING POINT (design/26 P6): a child is born to the possessed player,
 * and the world puts the week to them as a choice — drawn straight from the lifecycle's
 * `born` event, a pure read, answered with the generic verbs the engine already resolves.
 * Reactive: it surfaces the week the birth is recorded and ages out on its own.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, possess } from './sim';
import { evaluateDecisions } from './decision';
import { emit, fullActors } from './world';
import { maturityOf } from './pack';

/** The player, plus a co-parent and a stand-in newborn — all living adults of the focused town. */
function familyWorld() {
  const w = createWorld(123456);
  const adults = fullActors(w).filter((id) => {
    const lc = w.lifecycle.get(id)!;
    return lc.alive && lc.ageYears >= maturityOf(w.identity.get(id)!.speciesId) + 2;
  });
  const [player, coParent, child] = adults;
  possess(w, player);
  return { w, player, coParent, child };
}

describe('a child is born to you', () => {
  it('surfaces the week the birth is recorded, naming the child and the co-parent', () => {
    const { w, player, coParent, child } = familyWorld();
    // the lifecycle records a birth as [child, bearer, mate]; here the player is a parent
    emit(w, 'born', [child, player, coParent], {});
    const d = evaluateDecisions(w, player).find((d) => d.id.startsWith('family_birth:'));
    expect(d).toBeDefined();
    expect(d!.id).toBe(`family_birth:${child}`);
    // the co-parent, alive and present, is offered as someone to rejoice with (a socialize verb)
    const rejoice = d!.options.find((o) => o.intent.kind === 'socialize');
    expect(rejoice?.intent.target).toBe(coParent);
    // and the fallbacks are the plain generic verbs — no new mechanism
    expect(d!.options.some((o) => o.intent.kind === 'work')).toBe(true);
    expect(d!.options.some((o) => o.intent.kind === 'idle')).toBe(true);
  });

  it('is offered to a parent even with no living co-parent (just the plain verbs)', () => {
    const { w, player, child } = familyWorld();
    emit(w, 'born', [child, player], {}); // a birth with no recorded mate
    const d = evaluateDecisions(w, player).find((d) => d.id.startsWith('family_birth:'));
    expect(d).toBeDefined();
    expect(d!.options.some((o) => o.intent.kind === 'socialize')).toBe(false); // no one to rejoice with
    expect(d!.options.length).toBe(2); // work + idle
  });

  it('is NOT offered to the newborn themselves (the player must be the parent)', () => {
    const { w, player, coParent } = familyWorld();
    // player is subjects[0] here — the child, not a parent
    emit(w, 'born', [player, coParent], {});
    expect(evaluateDecisions(w, player).some((d) => d.id.startsWith('family_birth:'))).toBe(false);
  });

  it('ages out once the week has passed', () => {
    const { w, player, coParent, child } = familyWorld();
    emit(w, 'born', [child, player, coParent], {});
    w.tick += 8; // the birth is now older than a week (one player turn)
    expect(evaluateDecisions(w, player).some((d) => d.id.startsWith('family_birth:'))).toBe(false);
  });
});
