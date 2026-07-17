/**
 * Organizational execution (Phase 2D): turn a stored intent into a bounded ACTION.
 *
 * The execution layer has exactly one input — `world.currentIntent` (2C answered "what
 * should I do?"). It only asks "can I do it?". The pipeline, mirroring the actor resolver's
 * decide-then-apply split:
 *
 *   intent → actionForIntent → feasible?  (infeasible ⇒ nothing happens, NO history)
 *                            → resolve()  (PURE: decides outcome + DESCRIBES effects)
 *                            → applyEffects() + emit()   (only on a real outcome)
 *
 * Per Execution Constitution invariants 8–9: only an action's OUTCOME becomes history (an
 * unaffordable attempt is not history). Actions change the ORGANISATION and its seat's
 * existing economy/demographics/relations — never geography. Deterministic (no RNG), run
 * yearly in org-id order, on a per-org cooldown so the chronicle is not flooded.
 */
import {
  type World,
  type OrgId,
  type Organization,
  type OrgEffect,
  type OperationalState,
  DAYS_PER_YEAR,
  settlementPopulation,
} from './model';
import { INTENT_TO_ACTION, actionById, baselineOperational } from './pack';
import { emit, clamp } from './world';
import { recordDeed } from './reputation';
import { adjustTreasury } from './organization';
import { livingLegendsAt } from './legend';
import { retell } from './belief';
import { objectById } from './objects';
import { getFigure } from './figures';

/** Years an org waits between actions, so polities don't act (and chronicle) every year. */
const ACTION_COOLDOWN_YEARS = 4;

/** The action a given current intent triggers (intent → action; a future "plan" layer may
 *  decompose one intent into several). Undefined if the pack maps the intent to nothing. */
export function actionForIntent(intentKind: string) {
  const id = INTENT_TO_ACTION[intentKind];
  return id === undefined ? undefined : actionById(id);
}

/** The org's operational state, seeded to the pack baseline on first access. */
export function operationalOf(world: World, orgId: OrgId): OperationalState {
  let s = world.operationalState.get(orgId);
  if (!s) {
    s = baselineOperational();
    world.operationalState.set(orgId, s);
  }
  return s;
}

/**
 * Apply an action's effect descriptors to world state — the ONLY mutator in the execution
 * path. Every effect is bounded and clamped. Effects touch the org's operational stats, its
 * seat's existing economy/demographics, an adjacent edge's relation, or its reputation.
 */
export function applyEffects(world: World, org: Organization, effects: OrgEffect[]): void {
  const ops = operationalOf(world, org.id);
  const seat = org.seatId !== undefined ? world.settlements[org.seatId] : undefined;
  for (const e of effects) {
    switch (e.target) {
      case 'stat':
        ops[e.key] = clamp((ops[e.key] ?? 0) + e.delta, 0, 100);
        break;
      case 'wealth':
        if (seat) seat.econ.wealth = Math.max(0, seat.econ.wealth + e.delta);
        break;
      case 'treasury':
        // the org's OWN funds (2C: OrgResources) — action costs debit the tithe-fed
        // treasury, so what a polity does is bounded by what it has actually collected.
        adjustTreasury(world, org.id, e.delta);
        break;
      case 'stability':
        if (seat) seat.macro.stability = clamp(seat.macro.stability + e.delta, -100, 100);
        break;
      case 'relation': {
        if (org.seatId === undefined) break;
        for (const edge of world.edges) {
          const touchesBoth =
            (edge.a === org.seatId && edge.b === e.neighbourId) ||
            (edge.b === org.seatId && edge.a === e.neighbourId);
          if (touchesBoth) {
            edge.relation = clamp(edge.relation + e.delta, -100, 100);
            break;
          }
        }
        break;
      }
      case 'reputation':
        // the org's deed is witnessed by its seat's people — scales how widely it is known
        recordDeed(world, org.id, e.kind, { witnesses: seat ? Math.max(1, settlementPopulation(world, seat)) : 1 });
        break;
      case 'retell': {
        // a devotional order's rite (design/34): the leader retells the order's founding
        // legend to residents who lack it — inert belief formation through the existing
        // retell machinery, which is how the institution keeps its myth alive against
        // decay. Deterministic: the most-held version, told to the first eligible souls.
        if (org.legendSubjectId === undefined || org.seatId === undefined) break;
        const legends = livingLegendsAt(world, org.seatId).filter((l) => l.subject === org.legendSubjectId);
        if (!legends.length) break; // a legend no one still holds cannot be retold from
        const lg = legends.sort((a, b) => b.holders.length - a.holders.length || a.assertion.localeCompare(b.assertion))[0];
        const teller = org.leaderId !== undefined && lg.holders.includes(org.leaderId) ? org.leaderId : lg.holders[0];
        let told = 0;
        for (const id of world.entities) {
          if (told >= e.count) break;
          if (id === teller || world.homeSettlement.get(id) !== org.seatId) continue;
          if ((world.beliefs.get(id) ?? []).some((b) => b.subject === lg.subject && b.assertion === lg.assertion)) continue;
          retell(world, teller, id, lg.subject, lg.assertion, 0.6);
          told++;
        }
        break;
      }
      case 'recover_object': {
        // the Seekers find what they sought: the LOST relic passes to the seat's ruling
        // house. (The executor stamps the recovery into the object's history with the
        // emitted event's id, so its renown carries the finding.)
        const relic = objectById(world, e.objectId);
        const ruler = seat ? getFigure(world, seat.currentRulerId) : undefined;
        if (relic && relic.holderHouseId === undefined && ruler?.houseId !== undefined) relic.holderHouseId = ruler.houseId;
        break;
      }
    }
  }
}

/** Has this org's cooldown elapsed (or has it never acted)? */
function offCooldown(world: World, orgId: OrgId): boolean {
  const last = world.lastAction.get(orgId);
  if (!last) return true;
  return (world.tick - last.sinceTick) / DAYS_PER_YEAR >= ACTION_COOLDOWN_YEARS;
}

/**
 * Yearly: each living organization executes the action its current intent calls for —
 * decide, then (only on a real outcome) apply and record. Runs AFTER orgIntentYearly.
 */
export function orgActionYearly(world: World): void {
  for (const org of world.organizations) {
    if (org.dissolvedYear !== undefined) continue;
    if (!offCooldown(world, org.id)) continue;
    const intent = world.currentIntent.get(org.id);
    if (!intent) continue;
    const action = actionForIntent(intent.kind);
    if (!action) continue;

    const state = operationalOf(world, org.id);
    if (!action.feasible(world, org, state).ok) continue; // an unaffordable attempt is not history

    const outcome = action.resolve(world, org, state); // PURE — no mutation yet
    if (outcome.success) {
      applyEffects(world, org, outcome.effects);
      world.lastAction.set(org.id, {
        id: action.id, intentKind: intent.kind, outcome: 'success',
        effects: outcome.effects, summary: outcome.summary, sinceTick: world.tick,
      });
      const evId = emit(world, outcome.eventType, [org.id], outcome.eventData, [], org.seatId !== undefined ? [org.seatId] : []);
      // a recovered relic remembers its own finding (design/33: the biography lives in the
      // Events; renown is recomputed from this index) — stamped here because only the
      // executor knows the emitted event's id.
      for (const eff of outcome.effects) {
        if (eff.target === 'recover_object') {
          objectById(world, eff.objectId)?.history.push({ eventId: evId, year: Math.floor(world.tick / DAYS_PER_YEAR), kind: 'recovered' });
        }
      }
    } else {
      // a feasible attempt defeated by reality is still history; 2D's bounded actions never
      // reach here (feasible ⇒ success), but heavy actions (war/colonisation, later) will,
      // emitting their own "failed" event. For now just record the attempt's outcome.
      world.lastAction.set(org.id, {
        id: action.id, intentKind: intent.kind, outcome: 'failure',
        effects: [], summary: outcome.summary, sinceTick: world.tick,
      });
    }
  }
}
