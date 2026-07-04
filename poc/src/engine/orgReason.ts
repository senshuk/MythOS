/**
 * Organizational reasoning (Phase 2C): the pipeline that lets an organization form an
 * INTENT — and, above all, EXPLAIN it. Three stages, each pure, bounded, and inspectable:
 *
 *   perceive(org)      → what the org KNOWS  (bounded; only existing engine state; ephemeral)
 *   worldviewOf(org)   → what VALUES define it (mean of its living members' value profiles)
 *   evaluateIntent(org)→ what INTENT it chose + WHY (a full justification: weighted factors,
 *                        a score, and every runner-up's score)
 *
 * The engine owns the pipeline; the PACK (content/fixture.ts) owns the vocabulary —
 * worldview axes, candidate intents, and scoring rules. Crucially, an intent's `score`
 * function receives only perception + worldview + the org's own record, NEVER the World, so
 * reasoning cannot bypass perception and peek at global state. The whole pass is
 * deterministic (no RNG); it runs yearly in org-id order.
 *
 * Nothing here EXECUTES — forming intent is 2C; acting on it is 2D.
 */
import {
  type World,
  type OrgId,
  type EntityId,
  type PerceptionFact,
  type Worldview,
  type OrgIntent,
  type BeliefState,
  type StatusBelief,
  DAYS_PER_YEAR,
} from './model';
import { beliefOf, computeBelief, stanceFromConfidence, slotAssertion, coronationSlot } from './belief';
import {
  VALUES,
  type ValueAxis,
  SUBSISTENCE_RESOURCE,
  cultureById,
  worldviewFromValues,
  INTENTS,
  EVALUATOR_VERSION,
} from '../content/fixture';
import { getOrganization } from './organization';
import { getEvent, clamp } from './world';

/** The settlement an org is seated at, if its seat is a (living) settlement. */
function seatOf(world: World, orgId: OrgId) {
  const org = getOrganization(world, orgId);
  if (!org || org.seatId === undefined) return undefined;
  return world.settlements[org.seatId];
}

/** Mean value profile across the seat's LIVING residents (who carry a personality). The
 *  dead are not in world.entities, so they cannot vote — this satisfies the "a dead founder
 *  must not influence reasoning" rule by construction. When no individuals are simulated
 *  here (a non-focused settlement is aggregate), fall back to the people's CULTURE values —
 *  the org's disposition then reflects its culture, which every settlement has. */
function memberValueMean(world: World, seatId: number): Record<ValueAxis, number> {
  const sums = {} as Record<ValueAxis, number>;
  for (const axis of VALUES) sums[axis] = 0;
  let n = 0;
  for (const id of world.entities) {
    if (world.homeSettlement.get(id) !== seatId) continue;
    const pers = world.personality.get(id);
    if (!pers) continue;
    for (const axis of VALUES) sums[axis] += pers.values[axis] ?? 0;
    n++;
  }
  if (n === 0) {
    const s = world.settlements[seatId];
    return { ...cultureById(s.cultureId).values } as Record<ValueAxis, number>;
  }
  const mean = {} as Record<ValueAxis, number>;
  for (const axis of VALUES) mean[axis] = sums[axis] / n;
  return mean;
}

/** STAGE 2 — the org's worldview, derived fresh from its members' values (or its culture). */
export function worldviewOf(world: World, orgId: OrgId): Worldview {
  const s = seatOf(world, orgId);
  if (!s) return {};
  return worldviewFromValues(memberValueMean(world, s.id));
}

/**
 * An organization's BELIEF about (subject, assertion) — DERIVED from its members, never stored.
 * The epistemic twin of worldviewOf: an org owns no evidence stack of its own (that would be a
 * second source of truth); it reasons from the mean of its living members' beliefs. The
 * institution comes to know as its people do — one member knowing barely moves it; broad
 * awareness makes it true.
 *
 * SUBJECTIVITY EXISTS ONLY WHERE AGENCY EXISTS. If no members are simulated (an aggregate,
 * non-focused seat has no resident subjects), the org holds no belief — Unknown. When the
 * settlement comes into focus and its actors instantiate, the org's belief derives from them
 * again. No new exception to LOD — the same law worldviewOf already obeys, applied to knowledge.
 *
 * Pure read: touches no world state, adds no evidence stack to the org. A CONSUMER of derived
 * belief, exactly as org reasoning consumes derived worldview.
 *
 * This is the first collective BELIEF reducer, and the second collective reducer overall
 * (worldviewOf was the first). They are instances of one law — *individual minds are
 * first-class; collective minds are always derived* — so member fears → collective fear,
 * member morale → collective morale, etc. will follow the same shape. Do NOT preemptively
 * generalize into a `collectiveXOf` abstraction: name the concept only when a second
 * belief-consumer forces it. For now, keep this concrete.
 */
export function orgBeliefOf(world: World, orgId: OrgId, subject: EntityId, assertion: string): BeliefState {
  const s = seatOf(world, orgId);
  if (!s) return { stance: 'unknown', confidence: 0.5 };
  let sum = 0;
  let n = 0;
  for (const id of world.entities) {
    if (world.homeSettlement.get(id) !== s.id) continue;
    if (!world.personality.get(id)) continue; // a simulated resident — a subject that can know
    const held = beliefOf(world, id, subject, assertion);
    sum += held ? computeBelief(held, world.tick).confidence : 0.5; // holds none → Unknown baseline
    n++;
  }
  if (n === 0) return { stance: 'unknown', confidence: 0.5 }; // no subjects → no subjectivity
  const confidence = sum / n;
  return { stance: stanceFromConfidence(confidence), confidence };
}

/**
 * An organization's recognized occupant of `slot` — its ALLEGIANCE — DERIVED from members, never
 * stored. The status twin of `orgBeliefOf`, and the collective twin of `computeStatusBelief`: over
 * every claimant the members have heard of, it arg-maxes the org's DERIVED belief that the claimant
 * reigns (`orgBeliefOf` per claimant). So two polities whose members believe differently recognize
 * DIFFERENT rulers — allegiance runs on what the institution's people believe, not on who
 * objectively holds the throne, and it lags reality exactly as its members' knowledge does.
 *
 * Pure read; no state, no allegiance field. The reducer graph stays radial: this composes
 * `orgBeliefOf` (a radius), never a peer. Subjectivity only where agency exists — a seat with no
 * simulated members recognizes no one (Unknown), and re-derives when the settlement comes into focus.
 */
export function orgStatusBeliefOf(world: World, orgId: OrgId, slot: string): StatusBelief {
  const s = seatOf(world, orgId);
  if (!s) return { occupant: undefined, confidence: 0.5 };
  const assertion = slotAssertion(slot);
  // every claimant any resident member has heard of for this slot (deterministic insertion order)
  const claimants = new Set<EntityId>();
  for (const id of world.entities) {
    if (world.homeSettlement.get(id) !== s.id) continue;
    for (const b of world.beliefs.get(id) ?? []) {
      if (b.assertion === assertion) claimants.add(b.subject);
    }
  }
  // recognize the claimant the institution most collectively believes reigns
  let occupant: EntityId | undefined;
  let best = 0;
  for (const c of claimants) {
    const conf = orgBeliefOf(world, orgId, c, assertion).confidence;
    if (conf > best) {
      best = conf;
      occupant = c;
    }
  }
  if (occupant !== undefined && stanceFromConfidence(best) !== 'true') occupant = undefined;
  return { occupant, confidence: best };
}

/** STAGE 1 — what the org perceives. Bounded to its own seat, its immediate neighbours
 *  (the existing region graph), and recent events it was party to. Every fact carries a
 *  confidence; nothing global or hidden is read. Ephemeral — rebuilt each call. */
export function perceive(world: World, orgId: OrgId): PerceptionFact[] {
  const s = seatOf(world, orgId);
  if (!s) return [];
  const facts: PerceptionFact[] = [];

  // --- own seat (high confidence: it is the org's own house) ---
  let residents = 0;
  for (const id of world.entities) if (world.homeSettlement.get(id) === s.id) residents++;
  const pop = Math.max(s.macro.population, residents, 1);
  const yearsBuffer = (s.econ.stock[SUBSISTENCE_RESOURCE] ?? 0) / pop;
  facts.push({ id: 'food_security', value: Math.round(clamp(yearsBuffer * 20, 0, 100)), confidence: 1, source: 'seat' });
  facts.push({ id: 'stability', value: Math.round(s.macro.stability), confidence: 1, source: 'seat' });
  facts.push({ id: 'own_strength', value: Math.round(pop), confidence: 1, source: 'seat' });

  // LEGITIMACY (tri-state): does the institution recognize a settled ruler? A RECOGNIZED ruler is
  // settled (100); ≥2 competing claimants with no clear winner is a CONTESTED crisis (0); anything
  // else — no claimants, or no simulated members (an aggregate seat) — is UNKNOWN/neutral (50). The
  // consumer reacts to CONTESTATION, never to ignorance, so aggregate polities are never made cautious.
  {
    const assertion = slotAssertion(coronationSlot(s.id));
    const claimants = new Set<EntityId>();
    for (const id of world.entities) {
      if (world.homeSettlement.get(id) !== s.id) continue;
      for (const b of world.beliefs.get(id) ?? []) if (b.assertion === assertion) claimants.add(b.subject);
    }
    let best = 0;
    for (const c of claimants) {
      const cf = orgBeliefOf(world, orgId, c, assertion).confidence;
      if (cf > best) best = cf;
    }
    const recognized = stanceFromConfidence(best) === 'true';
    const settled = recognized ? 100 : claimants.size >= 2 ? 0 : 50;
    facts.push({ id: 'succession_settled', value: settled, confidence: 1, source: 'seat' });
  }

  // --- immediate neighbours via the region graph (lower confidence: only what's visible) ---
  let hostilitySum = 0;
  let hostileCount = 0;
  let neighbourStrengthSum = 0;
  let neighbourCount = 0;
  for (const e of world.edges) {
    const other = e.a === s.id ? e.b : e.b === s.id ? e.a : undefined;
    if (other === undefined) continue;
    const os = world.settlements[other];
    if (!os || os.ruinedYear !== undefined) continue;
    neighbourCount++;
    neighbourStrengthSum += os.macro.population;
    if (e.relation < 0) {
      hostilitySum += -e.relation;
      hostileCount++;
    }
  }
  const hostility = hostileCount > 0 ? hostilitySum / hostileCount : 0;
  facts.push({ id: 'border_hostility', value: Math.round(clamp(hostility, 0, 100)), confidence: 0.6, source: 'neighbours' });
  if (neighbourCount > 0) {
    const meanNeighbour = neighbourStrengthSum / neighbourCount;
    const weakness = (100 * (pop - meanNeighbour)) / (pop + meanNeighbour + 1);
    facts.push({ id: 'neighbor_weakness', value: Math.round(clamp(weakness, -100, 100)), confidence: 0.4, source: 'neighbours' });
  } else {
    facts.push({ id: 'neighbor_weakness', value: 0, confidence: 0.4, source: 'neighbours' });
  }

  // --- recent violence we were party to (confirmed: it happened to us) ---
  const year = Math.floor(world.tick / DAYS_PER_YEAR);
  let raids = 0;
  for (const eid of world.eventsBySettlement.get(s.id) ?? []) {
    const ev = getEvent(world, eid);
    if (!ev) continue;
    if ((ev.type === 'raid' || ev.type === 'battle' || ev.type === 'conquest') && year - ev.year <= 5) raids++;
  }
  facts.push({ id: 'border_raids', value: raids, confidence: 1, source: 'events' });

  return facts;
}

/** STAGE 3 — score every candidate intent and choose. Returns the complete justification:
 *  the winning factors (which SUM to the score), the worldview and perception that produced
 *  it, every alternative's score, and the evaluator version that scored it. */
export function evaluateIntent(world: World, orgId: OrgId): OrgIntent {
  const perception = perceive(world, orgId);
  const worldview = worldviewOf(world, orgId);
  const org = getOrganization(world, orgId)!;

  let best: { kind: string; score: number; factors: OrgIntent['factors'] } | undefined;
  const alternatives: { kind: string; score: number }[] = [];
  for (const def of INTENTS) {
    const factors = def.score(perception, worldview, org);
    const score = factors.reduce((sum, f) => sum + f.value, 0);
    alternatives.push({ kind: def.id, score });
    // strict `>` keeps the first-defined intent on a tie — deterministic, no RNG.
    if (!best || score > best.score) best = { kind: def.id, score, factors };
  }

  return {
    kind: best!.kind,
    score: best!.score,
    worldview,
    perception,
    factors: best!.factors,
    alternatives,
    sinceTick: world.tick,
    evaluatorVersion: EVALUATOR_VERSION,
  };
}

/**
 * Yearly: every living organization with a seat forms its current intent, stored in
 * world.currentIntent.
 *
 * This is a SILENT overlay. Reasoning is observation, not drama — it emits no events and
 * touches no other system's state, so adding it leaves the rest of the simulation
 * byte-identical (the director, chronicle, and seed-tuned dynamics are unperturbed).
 * Intent only enters history once it drives ACTION (Phase 2D); that is when a turn in
 * policy produces real, chronicle-worthy events.
 */
export function orgIntentYearly(world: World): void {
  for (const org of world.organizations) {
    if (org.dissolvedYear !== undefined) continue;
    if (seatOf(world, org.id) === undefined) continue;
    world.currentIntent.set(org.id, evaluateIntent(world, org.id));
  }
}
