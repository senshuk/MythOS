/**
 * Coronation → allegiance, rung 3: recognition changes intent.
 *
 * The first consumer that makes a belief change a DECISION. A polity's org reasoning reads its
 * recognition of a ruler (via the `succession_settled` perception fact, derived from
 * orgStatusBeliefOf) and, when the succession is CONTESTED, turns inward — it will not campaign
 * abroad. Tri-state: recognized → settled; ≥2 competing claimants → contested crisis; nothing
 * heard / no members → unknown (neutral). Contestation moves intent; ignorance never does.
 *
 * No new primitive, reducer, or storage — a pure consumer reading the frozen epistemic core.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, focusSettlement } from './sim';
import { fullActors } from './world';
import { getOrganization } from './organization';
import { learnCoronation } from './statusBelief';
import { coronationSlot } from './belief';
import { perceive, worldviewOf } from './orgReason';
import { intentById } from '../content/fixture';
import type { PerceptionFact } from './model';

function firstGoverned(w: ReturnType<typeof createWorld>) {
  for (const s of w.settlements) if (s.polityId !== undefined && s.ruinedYear === undefined) return s;
  return undefined;
}

const settledFact = (p: PerceptionFact[]) => p.find((f) => f.id === 'succession_settled')?.value;
function crisisFactor(w: ReturnType<typeof createWorld>, orgId: number, intentId: string): number {
  const factors = intentById(intentId)!.score(perceive(w, orgId), worldviewOf(w, orgId), getOrganization(w, orgId)!);
  return factors.find((x) => x.id === 'succession_crisis')?.value ?? 0;
}

describe('coronation → allegiance rung 3 — recognition changes intent', () => {
  it('a recognized ruler is SETTLED — no penalty to expansion', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const org = getOrganization(w, seat.polityId!)!;
    const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);
    const aldric = residents[0];
    residents.forEach((r) => learnCoronation(w, r, aldric, coronationSlot(seat.id), 0)); // all recognize Aldric

    expect(settledFact(perceive(w, org.id))).toBe(100);
    expect(crisisFactor(w, org.id, 'expand')).toBe(0);
  });

  it('an unheard-of succession is UNKNOWN, not a crisis — no penalty (ignorance stays neutral)', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const org = getOrganization(w, seat.polityId!)!;

    expect(settledFact(perceive(w, org.id))).toBe(50); // members exist but have heard of no ruler
    expect(crisisFactor(w, org.id, 'expand')).toBe(0);
  });

  it('competing claimants with no clear winner is a CONTESTED crisis — the polity turns inward', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const org = getOrganization(w, seat.polityId!)!;
    const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seat.id);
    const [aldric, beatrice] = residents;
    // a quarter recognize Aldric, a quarter Beatrice, the rest have heard nothing → no clear ruler
    const q = Math.floor(residents.length / 4);
    residents.slice(0, q).forEach((r) => learnCoronation(w, r, aldric, coronationSlot(seat.id), 0));
    residents.slice(q, 2 * q).forEach((r) => learnCoronation(w, r, beatrice, coronationSlot(seat.id), 0));

    expect(settledFact(perceive(w, org.id))).toBe(0);
    // recognition is contested → expansion and mobilisation are penalised
    expect(crisisFactor(w, org.id, 'expand')).toBeLessThan(0);
    expect(crisisFactor(w, org.id, 'prepare_war')).toBeLessThan(0);
  });
});
