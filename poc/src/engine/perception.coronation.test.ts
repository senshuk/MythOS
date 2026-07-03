/**
 * Coronation → allegiance, rung 2: the live producer.
 *
 * perceiveCoronation wires a settlement's succession into belief — residents of the focused
 * settlement come to believe their new ruler reigns, so the polity (orgStatusBeliefOf) recognizes
 * them. It fires only where residents are simulated, and revises when a new ruler is seated. Wired
 * into figures.ts (installRuler), so recognition now forms in a running world.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, focusSettlement } from './sim';
import { fullActors, emit } from './world';
import { getOrganization } from './organization';
import { perceiveCoronation } from './perception';
import { coronationSlot } from './statusBelief';
import { orgStatusBeliefOf } from './orgReason';

function firstGoverned(w: ReturnType<typeof createWorld>) {
  for (const s of w.settlements) if (s.polityId !== undefined && s.ruinedYear === undefined) return s;
  return undefined;
}

describe('coronation → allegiance rung 2 — the live coronation producer', () => {
  it('a coronation makes residents believe the new ruler reigns, so the polity recognizes them', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const org = getOrganization(w, seat.polityId!)!;
    const slot = coronationSlot(seat.id);
    const [aldric, beatrice] = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);

    // before any coronation the polity recognizes no one
    expect(orgStatusBeliefOf(w, org.id, slot).occupant).toBeUndefined();

    // Aldric is crowned; the town hears it → the polity recognizes Aldric
    perceiveCoronation(w, seat.id, aldric, emit(w, 'ascension', [aldric], {}));
    expect(orgStatusBeliefOf(w, org.id, slot).occupant).toBe(aldric);

    // Beatrice succeeds; the town hears → the polity's recognition revises
    perceiveCoronation(w, seat.id, beatrice, emit(w, 'ascension', [beatrice], {}));
    expect(orgStatusBeliefOf(w, org.id, slot).occupant).toBe(beatrice);
  });

  it('a coronation in a non-focused settlement forms no beliefs (no residents to hear it)', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const other = w.settlements.find((s) => s.id !== seat.id)!;
    const someRuler = fullActors(w)[0];

    perceiveCoronation(w, other.id, someRuler, emit(w, 'ascension', [someRuler], {}));
    // no resident anywhere picked up a belief about `other`'s ruler slot
    const slot = coronationSlot(other.id);
    const anyBelief = fullActors(w).some((id) =>
      (w.beliefs.get(id) ?? []).some((b) => b.assertion === `reigns:${slot}`),
    );
    expect(anyBelief).toBe(false);
  });
});
