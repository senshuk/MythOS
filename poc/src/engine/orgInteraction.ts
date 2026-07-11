/**
 * Organizational interaction (Phase 2E): organizations INTERACT — through negotiation,
 * never mutation (design/16). The engine understands exactly one shape:
 *
 *   proposal → evaluation → outcome
 *
 * A proposer describes an OFFER as data (an InteractionProposal, never a command). The
 * recipient evaluates it through ITS OWN bounded perception, worldview, and institutional
 * stance toward the proposer (2C relationships) — there is no omniscient assessment of a
 * deal, only each side's view of it. A pure resolver then DESCRIBES the outcome's effects
 * per party; the engine applies them (via 2D's applyEffects, the one mutator) and emits
 * ONE event that BOTH parties' histories cite — while each keeps its own summary of what
 * happened (the two-histories principle: a pact is a triumph in one record and a
 * capitulation in the other).
 *
 * What an "alliance", "tribute", or "pact" IS lives in the pack (fixture INTERACTIONS);
 * the engine only stores the residue: standing AGREEMENTS (world.orgAgreements) that
 * other systems read (a non-aggression pact stays a raid's hand in geographyYearly; a
 * trade agreement favours a route in economyYearly) and expire.
 *
 * Deterministic: no RNG anywhere — target choice, evaluation, and outcomes are pure
 * functions run in org-id order; acceptance is a threshold on the recipient's own score.
 */
import {
  type World,
  type OrgId,
  type Organization,
  type OrgAgreement,
  type InteractionDef,
  DAYS_PER_YEAR,
} from './model';
import { INTERACTIONS, INTENT_TO_INTERACTION, ORG_INTERACTION } from './pack';
import { emit } from './world';
import { perceive, worldviewOf } from './orgReason';
import { applyEffects } from './orgAction';
import { getOrganization, orgOpinionOf, noteOrgThought, seatSettlement } from './organization';

/** The polity a possessed player currently RULES (seated at their home settlement), or
 *  undefined — the seam that hands an incoming proposal to the player instead of evaluate(). */
export function playerRuledPolity(world: World): OrgId | undefined {
  const p = world.playerId;
  if (p === undefined) return undefined;
  const home = world.homeSettlement.get(p);
  const s = home !== undefined ? world.settlements[home] : undefined;
  if (!s || s.polityId === undefined || s.currentRulerId !== p) return undefined;
  return s.polityId;
}

export function interactionById(id: string): InteractionDef | undefined {
  return INTERACTIONS.find((d) => d.id === id);
}

/** The interaction a current intent inclines an org toward (pack map), if any. */
export function interactionForIntent(intentKind: string): InteractionDef | undefined {
  const id = INTENT_TO_INTERACTION[intentKind];
  return id === undefined ? undefined : interactionById(id);
}

// ---- agreements (the persistent residue) -------------------------------------

const agreementKey = (a: OrgId, b: OrgId): [OrgId, OrgId] => (a < b ? [a, b] : [b, a]);

/** The active agreement of `kind` between two orgs, if one is in force. */
export function activeAgreement(world: World, kind: string, x: OrgId, y: OrgId): OrgAgreement | undefined {
  const [a, b] = agreementKey(x, y);
  for (const g of world.orgAgreements) {
    if (g.kind === kind && g.a === a && g.b === b && g.expiresTick > world.tick) return g;
  }
  return undefined;
}

/** Seal an agreement (replacing any expired duplicate is unnecessary — expired entries
 *  are pruned yearly; an ACTIVE duplicate is the caller's bug to avoid via activeAgreement). */
export function sealAgreement(world: World, kind: string, x: OrgId, y: OrgId, years: number): OrgAgreement {
  const [a, b] = agreementKey(x, y);
  const g: OrgAgreement = { kind, a, b, sinceTick: world.tick, expiresTick: world.tick + years * DAYS_PER_YEAR };
  world.orgAgreements.push(g);
  return g;
}

/** Drop expired agreements (bounded state; the events remain as history). */
export function pruneAgreements(world: World): void {
  if (world.orgAgreements.some((g) => g.expiresTick <= world.tick)) {
    world.orgAgreements = world.orgAgreements.filter((g) => g.expiresTick > world.tick);
  }
}

// ---- the pipeline -------------------------------------------------------------

/** Neighbour polities of an org's seat along the region graph, in edge order —
 *  the candidate counterparties a proposal may be addressed to. */
export function neighbourPolities(world: World, org: Organization): Organization[] {
  const seat = seatSettlement(world, org);
  if (!seat) return [];
  const out: Organization[] = [];
  for (const e of world.edges) {
    const otherId = e.a === seat.id ? e.b : e.b === seat.id ? e.a : undefined;
    if (otherId === undefined) continue;
    const os = world.settlements[otherId];
    if (!os || os.ruinedYear !== undefined || os.polityId === undefined) continue;
    const other = getOrganization(world, os.polityId);
    if (other && other.dissolvedYear === undefined) out.push(other);
  }
  return out;
}

/** Has this org's interaction cooldown elapsed (or has it never interacted)? */
function offCooldown(world: World, orgId: OrgId): boolean {
  const last = world.lastInteraction.get(orgId);
  if (!last) return true;
  return (world.tick - last.sinceTick) / DAYS_PER_YEAR >= ORG_INTERACTION.cooldownYears;
}

/**
 * Resolve one proposal end-to-end: the recipient evaluates through its OWN bounded view
 * (perception + worldview + stance toward the proposer), the pack's outcome() describes
 * the consequences of acceptance or refusal, and the engine applies + records:
 *
 *  - ONE event, with BOTH orgs as subjects (each subject's history cites it);
 *  - per-party effects through applyEffects (the only mutator, 2D);
 *  - TWO OrgInteractionRecords — each side's own summary of the same moment;
 *  - an institutional thought on the pair (2C): dealings warm or wound the stance.
 *
 * Exported for tests and (later) player-initiated proposals; the yearly pass drives it.
 */
export function resolveProposal(world: World, def: InteractionDef, from: Organization, to: Organization, terms: Record<string, number | string>): boolean {
  // the recipient's own view of the offer — never the world's
  const factors = def.evaluate(perceive(world, to.id), worldviewOf(world, to.id), orgOpinionOf(world, to.id, from.id), terms, from);
  const score = factors.reduce((s, f) => s + f.value, 0);
  return applyProposalOutcome(world, def, from, to, terms, score > 0);
}

/**
 * Apply a DECIDED proposal — the outcome tail shared by NPC negotiation (acceptance from
 * `evaluate`) and a ruler-player's audience (acceptance is the player's own will). Given who
 * accepted, the pack's pure `outcome()` describes the consequences; the engine applies them,
 * seals any agreement, emits ONE event both parties cite, writes TWO records (each side's
 * summary), and moves the institutional stance. The single mutator for an interaction.
 */
export function applyProposalOutcome(world: World, def: InteractionDef, from: Organization, to: Organization, terms: Record<string, number | string>, accepted: boolean): boolean {
  const outcome = def.outcome(world, from, to, terms, accepted); // PURE — describes only
  for (const pe of outcome.effects) {
    applyEffects(world, pe.party === 'from' ? from : to, [pe.effect]);
  }
  if (accepted && outcome.agreement) {
    sealAgreement(world, outcome.agreement.kind, from.id, to.id, outcome.agreement.years);
  }
  const evId = emit(world, outcome.eventType, [from.id, to.id], outcome.eventData, [], [
    ...(from.seatId !== undefined ? [from.seatId] : []),
    ...(to.seatId !== undefined ? [to.seatId] : []),
  ]);
  world.lastInteraction.set(from.id, { kind: def.id, withOrg: to.id, role: 'proposer', accepted, summary: outcome.summaryFrom, sinceTick: world.tick, eventId: evId });
  world.lastInteraction.set(to.id, { kind: def.id, withOrg: from.id, role: 'recipient', accepted, summary: outcome.summaryTo, sinceTick: world.tick, eventId: evId });

  // dealings move the institutional stance (2C): a sealed accord warms the pair; a
  // refused demand wounds it. Pack thought kinds, engine-neutral.
  noteOrgThought(world, from.id, to.id, accepted ? ORG_INTERACTION.acceptThought : ORG_INTERACTION.refuseThought, evId);
  return accepted;
}

/**
 * Yearly: each living org whose CURRENT INTENT (2C reasoning) inclines it toward an
 * interaction — and whose cooldown has elapsed — addresses one proposal to a neighbour
 * polity of the pack's choosing. Runs after orgIntentYearly (fresh intents) and before
 * orgActionYearly (a year's diplomacy precedes its domestic works); expired agreements
 * are pruned first. Org-id order; RNG-free.
 */
export function orgInteractionYearly(world: World): void {
  pruneAgreements(world);
  const ruled = playerRuledPolity(world); // the polity (if any) whose envoys await the player
  for (const org of world.organizations) {
    if (org.dissolvedYear !== undefined) continue;
    if (!offCooldown(world, org.id)) continue;
    const intent = world.currentIntent.get(org.id);
    if (!intent) continue;
    const def = interactionForIntent(intent.kind);
    if (!def) continue;

    const candidates = neighbourPolities(world, org);
    if (!candidates.length) continue;
    const proposal = def.propose(world, org, candidates);
    if (!proposal) continue; // nothing worth proposing — not history (invariant 8)
    const to = getOrganization(world, proposal.to);
    if (!to || to.dissolvedYear !== undefined) continue;

    // If the proposal is addressed to the polity a PLAYER rules, the answer is theirs to
    // give (design/26 P2): park it for an audience instead of auto-resolving. One envoy
    // waits at a time — a fresh offer only displaces a stale one (an unanswered overture
    // ages out), so the throne room is never buried. Player-only: an NPC/spectator world
    // never enters this branch, so its diplomacy is byte-identical.
    if (proposal.to === ruled) {
      const held = world.pendingEnvoy;
      const stale = held !== undefined && (world.tick - held.sinceTick) / DAYS_PER_YEAR >= ORG_INTERACTION.cooldownYears;
      if (held === undefined || stale) {
        world.pendingEnvoy = { from: org.id, to: to.id, defId: def.id, terms: proposal.terms, sinceTick: world.tick };
      }
      continue; // parked, not resolved — a considered proposal is not yet history
    }

    resolveProposal(world, def, org, to, proposal.terms);
  }
}
