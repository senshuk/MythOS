/**
 * The PACK's ACTION vocabulary — the verbs an actor (player or NPC) can choose, as
 * DATA. The engine resolves a few GENERIC social/economic verbs as core mechanism
 * (idle/work/socialize/court/give/provoke live in systems/resolve.ts), but two things
 * are universe-facing and belong here:
 *
 *   - PLAYER_ACTIONS: the affordances offered to the player (label, hint, whether the
 *     verb needs a target). A pack relabels 'Court' → 'Pursue', drops verbs, or adds
 *     its own.
 *   - resolveExtraAction: resolution for any kind the engine's core resolver doesn't
 *     know — a Cyberpunk 'hack', a Star Trek 'hail'. The engine's resolveIntent falls
 *     through to this for unknown kinds, so a pack adds a verb WITHOUT an engine change.
 *
 * This pack ships the generic verbs plus its LEVERS: press_claim (a bid for the seat)
 * and the AUDIENCE verdicts (design/26 P2) — adjudicate a feud, endow the shrine,
 * dismiss the petitioners. Every audience verdict acts ONLY through existing
 * mechanism (thoughts, reputation witnesses, the org treasury) and emits a real
 * event, so a ruling is as traceable as any other outcome.
 */
import { type World, type EntityId, type PlayerActionView } from '../engine/model';
import { type Intent } from '../engine/intent';
import { Rng } from '../engine/rng';
import { pressClaim } from '../engine/figures';
import { emit, getRel, isAlive } from '../engine/world';
import { addThought } from '../engine/opinion';
import { strongestFeud } from '../engine/social';
import { witnessDeed } from '../engine/perception';
import { adjustTreasury, treasuryOf, getOrganization } from '../engine/organization';
import { pickVenue } from '../engine/venues';
import { applyProposalOutcome, resolveProposal, interactionById } from '../engine/orgInteraction';
import { patronDeityOf, ORG_INTERACTION } from './fixture';

/** The actions offered to the player this turn. (NPC choice is in systems/decide.ts.) */
export const PLAYER_ACTIONS: PlayerActionView[] = [
  { kind: 'work', label: 'Work', hint: 'ply your profession (feeds you)', needsTarget: false },
  { kind: 'socialize', label: 'Socialize', hint: 'spend time with someone', needsTarget: true },
  { kind: 'court', label: 'Court', hint: 'pursue a bond toward marriage', needsTarget: true },
  { kind: 'give', label: 'Give', hint: 'a deliberate kindness', needsTarget: true },
  { kind: 'provoke', label: 'Provoke', hint: 'a deliberate slight', needsTarget: true },
  { kind: 'idle', label: 'Rest', hint: 'let the week pass', needsTarget: false },
];

/** A resolver for a pack-specific verb: apply its effects, drawing randomness from `rng`.
 *  Receives the WHOLE intent so a verb can carry a mode ('adjudicate' rules FOR someone
 *  or reconciles; 'dismiss_petition' names which petition it waves away). */
export type ActionResolver = (world: World, actor: EntityId, intent: Intent, rng: Rng) => void;

/** How much a shrine endowment moves from the polity's treasury. */
const SHRINE_ENDOWMENT = 30;

/**
 * Registry of pack-specific verbs the engine's core resolver doesn't know. A real pack
 * registers e.g. EXTRA_ACTIONS['hack'] = (world, actor, …) => {…}, calling engine
 * mechanism (world.ts / opinion.ts) for the effects.
 */
export const EXTRA_ACTIONS: Record<string, ActionResolver> = {
  /** A proactive bid for the settlement's seat. Routes into the succession machinery
   *  (engine/figures.ts pressClaim) — the first player LEVER on the grand systems. */
  press_claim: (world, actor, _intent, rng) => pressClaim(world, actor, rng),

  /**
   * AUDIENCE — judge the feud brought before the seat (design/26 P2). `target` is one
   * party; the other is their bitterest foe, re-read at resolution so a stale petition
   * quietly no-ops. mode 'reconcile' imposes a truce (both parties think better of each
   * other AND of the ruler; peacemaking earns witnessed renown, the same repute deed a
   * voluntary reconciliation earns). mode 'favor' rules FOR the target: the favored
   * warms to the ruler, the disfavored resents both ruler and rival the more.
   */
  adjudicate: (world, ruler, intent, _rng) => {
    const a = intent.target;
    if (a === undefined || !isAlive(world, a)) return;
    const b = strongestFeud(world, a);
    if (b === undefined || !isAlive(world, b)) return;
    const verdict = intent.mode === 'reconcile' ? 'reconcile' : 'favor';
    const evId = emit(
      world,
      'judgment',
      [ruler, a, b],
      { verdict, petition: 'judgment', ...pickVenue(world, 'judgment', a, b) },
      [],
    );
    if (verdict === 'reconcile') {
      // the truce: a strong, slow-fading positive thought BETWEEN the parties…
      addThought(getRel(world, a, b), 'judgment_truce', world.tick, { cause: evId });
      // …and both think better of the judge; the town sees a peacemaker at work
      addThought(getRel(world, ruler, a), 'judgment_favor', world.tick, { cause: evId });
      addThought(getRel(world, ruler, b), 'judgment_favor', world.tick, { cause: evId });
      witnessDeed(world, evId, ruler, a, 'reconciliation');
    } else {
      // ruling FOR a: the favored warms to the ruler; the disfavored resents the
      // ruler AND their rival the more (a verdict can harden what it settles)
      addThought(getRel(world, ruler, a), 'judgment_favor', world.tick, { cause: evId });
      addThought(getRel(world, ruler, b), 'judgment_wrong', world.tick, { cause: evId });
      addThought(getRel(world, a, b), 'slighted', world.tick, { cause: evId });
    }
  },

  /**
   * AUDIENCE — endow the shrine from the polity's treasury (design/26 P2). A REAL
   * transfer via the org's own treasury API (never minted); every living follower of
   * the local faith thinks better of the ruler. The event carries the amount so the
   * chronicle can say exactly what generosity cost.
   */
  fund_shrine: (world, ruler, _intent, _rng) => {
    const h = world.homeSettlement.get(ruler);
    const s = h !== undefined ? world.settlements[h] : undefined;
    if (!s || s.polityId === undefined) return;
    const amount = Math.min(SHRINE_ENDOWMENT, treasuryOf(world, s.polityId));
    if (amount <= 0) return;
    adjustTreasury(world, s.polityId, -amount);
    const evId = emit(
      world,
      'shrine_funding',
      [ruler],
      { amount: Math.round(amount), petition: 'shrine', ...pickVenue(world, 'shrine_funding', ruler, ruler) },
      [],
    );
    // the PATRON's faithful are grateful — every living local follower of the shrine's
    // own deity warms to the ruler (a bounded pass over the focused settlement's souls)
    const patron = patronDeityOf(s.cultureId);
    for (const [aid, deity] of world.faith) {
      if (aid === ruler || !isAlive(world, aid)) continue;
      if (world.homeSettlement.get(aid) !== h) continue;
      if (patron && deity !== patron.id) continue;
      addThought(getRel(world, ruler, aid), 'judgment_favor', world.tick, { cause: evId, value: 60 });
    }
  },

  /**
   * STEER THE POLITY (design/26 P4) — the seated ruler bids their own polity pursue one
   * of the intents IT already rates. Sets a mandate (honoured yearly only while it names
   * a real contender — the bounded vote lives in orgReason, not here) and records the
   * steer. `mode` is the intent kind chosen. A no-op if the actor holds no seat.
   */
  steer_polity: (world, ruler, intent, _rng) => {
    const kind = intent.mode;
    if (!kind) return;
    const h = world.homeSettlement.get(ruler);
    const s = h !== undefined ? world.settlements[h] : undefined;
    if (!s || s.polityId === undefined || s.currentRulerId !== ruler) return;
    world.orgMandate.set(s.polityId, { kind, sinceTick: world.tick });
    emit(world, 'polity_steered', [ruler], { intent: kind, ...pickVenue(world, 'polity_steered', ruler, ruler) }, []);
  },

  /**
   * ENVOY AUDIENCE (2E, design/26 P2) — answer a neighbour polity's parked proposal. The
   * player IS the recipient's will, so their `mode` ('accept'|'reject') replaces the org's
   * evaluate() score; the shared outcome tail then seals/refuses, emits the one event both
   * courts cite, and writes each side's record. A no-op if the player no longer rules the
   * addressed polity or the envoy has gone (dissolved proposer, cleared). The envoy is
   * consumed either way — an answer given is an answer given.
   */
  answer_envoy: (world, ruler, intent, _rng) => {
    const env = world.pendingEnvoy;
    if (!env) return;
    const h = world.homeSettlement.get(ruler);
    const s = h !== undefined ? world.settlements[h] : undefined;
    if (!s || s.polityId !== env.to || s.currentRulerId !== ruler) return; // must still hold the seat addressed
    world.pendingEnvoy = undefined; // consumed on answer, accepted or not
    const def = interactionById(env.defId);
    const from = getOrganization(world, env.from);
    const to = getOrganization(world, env.to);
    if (!def || !from || !to || from.dissolvedYear !== undefined || to.dissolvedYear !== undefined) return;
    applyProposalOutcome(world, def, from, to, env.terms, intent.mode === 'accept');
  },

  /**
   * PROPOSE A PACT (2E outgoing) — a ruler-player addresses a peaceful pact to a neighbour
   * polity. `target` is the neighbour's SEAT settlement; `mode` the interaction id
   * ('trade_agreement' | 'non_aggression'). The player proposes; the NEIGHBOUR's OWN bounded
   * view decides (resolveProposal runs its evaluate()) — the player is a proposer, never a
   * god-hand. A no-op if the actor holds no seat or the target is not a living polity's seat.
   */
  propose_pact: (world, ruler, intent, _rng) => {
    const h = world.homeSettlement.get(ruler);
    const s = h !== undefined ? world.settlements[h] : undefined;
    if (!s || s.polityId === undefined || s.currentRulerId !== ruler) return;
    const from = getOrganization(world, s.polityId);
    const ts = intent.target !== undefined ? world.settlements[intent.target] : undefined;
    if (!from || !ts || ts.ruinedYear !== undefined || ts.polityId === undefined || ts.polityId === s.polityId) return;
    const to = getOrganization(world, ts.polityId);
    const def = interactionById(intent.mode ?? '');
    if (!to || to.dissolvedYear !== undefined || !def) return;
    resolveProposal(world, def, from, to, { years: ORG_INTERACTION.agreementYears });
  },

  /** AUDIENCE — turn the petitioners away. The refusal is itself an OUTCOME (recorded,
   *  suppressing the petition for the season); the spurned think a little less of the
   *  seat. `mode` names which petition was waved off. */
  dismiss_petition: (world, ruler, intent, _rng) => {
    const petition = intent.mode ?? 'petition';
    const evId = emit(world, 'petition_dismissed', [ruler], { petition }, []);
    if (petition === 'judgment' && intent.target !== undefined && isAlive(world, intent.target)) {
      const a = intent.target;
      const b = strongestFeud(world, a);
      addThought(getRel(world, ruler, a), 'slighted', world.tick, { cause: evId, value: -40 });
      if (b !== undefined && isAlive(world, b)) {
        addThought(getRel(world, ruler, b), 'slighted', world.tick, { cause: evId, value: -40 });
      }
    }
  },
};

/** Engine entry point: resolve an unknown verb via the pack registry (no-op if absent). */
export function resolveExtraAction(world: World, actor: EntityId, intent: Intent, rng: Rng): void {
  EXTRA_ACTIONS[intent.kind]?.(world, actor, intent, rng);
}
