/**
 * The PACK's DECISION set — the turning points THIS universe puts to a player, as DATA. The engine
 * (engine/decision.ts) owns only the mechanism (gather, rank, cap); which situations exist and how
 * they read is universe-specific and lives here, exactly like PLAYER_ACTIONS (content/actions.ts)
 * and the aspiration ladder (content/aspirations.ts).
 *
 * Every option maps to an ordinary Intent, so a decision NEVER needs new resolver code: this fixture
 * composes turning points out of the six generic verbs the engine already resolves. A richer pack
 * can point an option at a pack-specific verb (content/actions.ts EXTRA_ACTIONS) with no engine
 * change. `evaluate` is a PURE READ — it derives the choice from current state and must not mutate.
 *
 * Two flavours, both stateless:
 *   - REACTIVE decisions key off events/beliefs of the PAST WEEK and age out on their own (a player
 *     turn advances exactly one week, so "this week's news" naturally stops being this week's).
 *   - STANDING decisions derive from durable state (a feud, a warming bond) and clear when it does.
 */
import { type World, type EntityId, type DecisionDef, type DecisionView, type EventPart, DAYS_PER_YEAR } from '../engine/model';
import { fullName, isKin, isAlive, getEvent } from '../engine/world';
import { computeOpinion } from '../engine/opinion';
import { bestSuitor, strongestFeud, isRuler } from '../engine/social';
import { treasuryOf, getOrganization } from '../engine/organization';
import { getChildren } from '../engine/location';
import { interactionById } from '../engine/orgInteraction';
import { patronDeityOf, intentLabel, ORG_INTERACTION } from './fixture';

/** Days that count as "this week" — one player turn advances exactly this far, so a reactive
 *  decision surfaces the week just lived and is gone by the next. */
const WEEK = 7;

/** AUDIENCES (design/26 P2) cadence: a quarter of the year. Each season mints fresh
 *  petition ids, so a NEW season's petition HOLDS streaming time (the throne-room
 *  moment); a verdict or dismissal suppresses that petition for a season. */
const SEASON = 91;
const seasonOf = (world: World) => Math.floor(world.tick / SEASON);

/** Has the seat already answered (or dismissed) this petition kind within a season?
 *  Read from HISTORY — a verdict is an event, so the suppression needs no state. */
function petitionHandled(world: World, kind: string): boolean {
  const since = world.tick - SEASON;
  for (let i = world.events.length - 1; i >= 0; i--) {
    const ev = world.events[i];
    if (ev.tick < since) break;
    if (
      (ev.type === 'judgment' || ev.type === 'shrine_funding' || ev.type === 'petition_dismissed') &&
      ev.data.petition === kind
    ) {
      return true;
    }
  }
  return false;
}

/** The town's bitterest feud PAIR among living souls (excluding the ruler) — the
 *  quarrel most likely to be dragged before the seat. Deterministic: worst summed
 *  opinion wins, lowest ids break ties. */
function bitterestFeudPair(world: World, home: number, exclude: EntityId): [EntityId, EntityId] | undefined {
  let pa: EntityId | undefined;
  let pb: EntityId | undefined;
  let worst = 0;
  for (const [a, edges] of world.rels) {
    if (a === exclude || world.homeSettlement.get(a) !== home || !isAlive(world, a)) continue;
    for (const [b, edge] of edges) {
      if (b <= a) continue; // each undirected edge once
      if (!edge.flags.feud) continue;
      if (b === exclude || world.homeSettlement.get(b) !== home || !isAlive(world, b)) continue;
      const op = computeOpinion(edge, world.tick);
      if (op < worst) {
        worst = op;
        pa = a;
        pb = b;
      }
    }
  }
  return pa !== undefined && pb !== undefined ? [pa, pb] : undefined;
}

/** A prompt fragment naming a person, rendered as a clickable link in the UI. */
const who = (world: World, id: EntityId): EventPart => ({ text: fullName(world, id), ref: { kind: 'actor', id } });

/** The player's most recent kin still living (excluding `except`), by warmth — someone to turn to. */
function closestLivingKin(world: World, id: EntityId, except: EntityId): EntityId | undefined {
  let best: EntityId | undefined;
  let bestOp = -Infinity;
  for (const [other, edge] of world.rels.get(id) ?? []) {
    if (other === except || !isKin(world, id, other) || !isAlive(world, other)) continue;
    const op = computeOpinion(edge, world.tick);
    if (op > bestOp) { bestOp = op; best = other; }
  }
  return best;
}

export const DECISIONS: DecisionDef[] = [
  // ── AUDIENCE: a feud is brought before the seat (design/26 P2) ─────────────────────────────
  // Warsim's throne room from REAL state: the town's bitterest feud pair petitions its ruler.
  // Every verdict acts through existing mechanism (thoughts, repute) via the 'adjudicate' verb;
  // even the refusal is an outcome (recorded, suppressing the petition for a season).
  {
    id: 'audience_judgment',
    evaluate(world, id): DecisionView[] {
      if (!isRuler(world, id)) return [];
      if (petitionHandled(world, 'judgment')) return [];
      const home = world.homeSettlement.get(id);
      if (home === undefined) return [];
      const pair = bitterestFeudPair(world, home, id);
      if (!pair) return [];
      const [a, b] = pair;
      return [{
        id: `aud:judgment:${seasonOf(world)}:${a}:${b}`,
        urgency: 85,
        prompt: [
          who(world, a),
          { text: ' and ' },
          who(world, b),
          { text: ' bring their feud before your seat, each demanding judgment against the other.' },
        ],
        options: [
          { label: 'Bid them make peace', hint: 'impose a truce — both will remember your fairness', intent: { kind: 'adjudicate', target: a, mode: 'reconcile', conscience: { axis: 'honor', dir: 1 } }, tone: 'good' },
          { label: `Rule for ${fullName(world, a)}`, hint: 'the favored will warm to you; the wronged will not forget', intent: { kind: 'adjudicate', target: a, mode: 'favor' }, tone: 'neutral' },
          { label: `Rule for ${fullName(world, b)}`, hint: 'the favored will warm to you; the wronged will not forget', intent: { kind: 'adjudicate', target: b, mode: 'favor' }, tone: 'neutral' },
          { label: 'Turn them away', hint: 'the seat owes no answer — but the spurned remember', intent: { kind: 'dismiss_petition', target: a, mode: 'judgment', conscience: { axis: 'honor', dir: -1 } }, tone: 'bad' },
        ],
      }];
    },
  },

  // ── AUDIENCE: the shrine asks an endowment ──────────────────────────────────────────────────
  // The keepers of the patron's shrine petition the seat when the coffers are full. Granting
  // moves REAL treasury (the org's own funds API) and warms every local follower of the faith.
  {
    id: 'audience_shrine',
    evaluate(world, id): DecisionView[] {
      if (!isRuler(world, id)) return [];
      if (petitionHandled(world, 'shrine')) return [];
      const home = world.homeSettlement.get(id);
      const s = home !== undefined ? world.settlements[home] : undefined;
      if (!s || s.polityId === undefined) return [];
      const funds = treasuryOf(world, s.polityId);
      if (funds < 60) return []; // the keepers only ask of a full coffer
      const patron = patronDeityOf(s.cultureId);
      if (!patron) return [];
      if (!getChildren(world, s.id).some((l) => l.locationType === 'shrine')) return [];
      return [{
        id: `aud:shrine:${seasonOf(world)}`,
        urgency: 60,
        prompt: [
          {
            text: `Keepers of the shrine of ${patron.name} come before your seat, asking an endowment of 30 from a treasury of ${Math.round(funds)}.`,
          },
        ],
        options: [
          { label: 'Endow the shrine', hint: 'the faithful will remember your piety', intent: { kind: 'fund_shrine', conscience: { axis: 'tradition', dir: 1 } }, tone: 'good' },
          { label: 'Turn them away', hint: 'the coffers stay full; the keepers leave empty-handed', intent: { kind: 'dismiss_petition', mode: 'shrine', conscience: { axis: 'tradition', dir: -1 } }, tone: 'bad' },
        ],
      }];
    },
  },

  // ── AUDIENCE: a neighbour's envoy stands before your seat (2E, design/26 P2) ─────────────────
  // A neighbour polity's REAL proposal (its yearly diplomacy, parked because it is addressed
  // to the polity YOU rule) brought to the throne. Your answer is the recipient's will — it
  // flows through the same interaction outcome an NPC recipient's evaluate() would, so a pact
  // you seal binds exactly as one the world negotiates without you.
  {
    id: 'audience_envoy',
    evaluate(world, id): DecisionView[] {
      const env = world.pendingEnvoy;
      if (!env) return [];
      // you must still hold the very seat the envoy was sent to
      const home = world.homeSettlement.get(id);
      const s = home !== undefined ? world.settlements[home] : undefined;
      if (!s || s.polityId !== env.to || s.currentRulerId !== id) return [];
      // an unanswered envoy grows stale and is withdrawn (the same window the sim replaces it in)
      if ((world.tick - env.sinceTick) / DAYS_PER_YEAR >= ORG_INTERACTION.cooldownYears) return [];
      const def = interactionById(env.defId);
      const from = getOrganization(world, env.from);
      if (!def || !from || from.dissolvedYear !== undefined) return [];
      const envoyOf: EventPart = from.seatId !== undefined
        ? { text: `the ${from.name}`, ref: { kind: 'settlement', id: from.seatId } }
        : { text: `the ${from.name}` };

      // per-interaction phrasing: what is being asked, and how accepting/refusing reads
      let ask: string;
      let accept: DecisionView['options'][number];
      let refuse: DecisionView['options'][number];
      if (env.defId === 'demand_tribute') {
        const amount = Number(env.terms.amount);
        ask = ` demands tribute of ${amount} under the shadow of its strength. Do you pay?`;
        accept = { label: `Pay the ${amount}`, hint: 'buy peace with coin — your coffers, their goodwill', intent: { kind: 'answer_envoy', mode: 'accept', conscience: { axis: 'honor', dir: -1 } }, tone: 'neutral' };
        refuse = { label: 'Defy them', hint: 'keep your gold and your pride — and risk the reprisal', intent: { kind: 'answer_envoy', mode: 'reject', conscience: { axis: 'war', dir: 1 } }, tone: 'bad' };
      } else if (env.defId === 'non_aggression') {
        ask = ' offers to swear peace along your shared border. Do you accept?';
        accept = { label: 'Swear the peace', hint: 'stay both courts’ hands while it holds', intent: { kind: 'answer_envoy', mode: 'accept', conscience: { axis: 'war', dir: -1 } }, tone: 'good' };
        refuse = { label: 'Refuse', hint: 'keep your sword arm free', intent: { kind: 'answer_envoy', mode: 'reject', conscience: { axis: 'war', dir: 1 } }, tone: 'neutral' };
      } else {
        ask = ' proposes a trade agreement — favoured commerce between your peoples. Do you accept?';
        accept = { label: 'Seal the agreement', hint: 'merchants move under the pact’s protection', intent: { kind: 'answer_envoy', mode: 'accept' }, tone: 'good' };
        refuse = { label: 'Decline', hint: 'keep your markets your own', intent: { kind: 'answer_envoy', mode: 'reject' }, tone: 'neutral' };
      }
      return [{
        id: `aud:envoy:${env.sinceTick}:${env.from}`,
        urgency: 72,
        prompt: [{ text: 'An envoy of ' }, envoyOf, { text: ask }],
        options: [accept, refuse],
      }];
    },
  },

  // ── AUDIENCE: steer your own polity (design/26 P4) ──────────────────────────────────────────
  // A CK council vote WITHOUT breaking org discipline: the org has already reasoned (with
  // bounded knowledge) to a chosen intent and rated the alternatives. The ruler picks among
  // the org's OWN top options — the pick becomes a mandate honoured only while the org still
  // rates it a contender (engine/orgReason). Abstain and the org's own choice stands.
  {
    id: 'steer_polity',
    evaluate(world, id): DecisionView[] {
      if (!isRuler(world, id)) return [];
      const home = world.homeSettlement.get(id);
      const s = home !== undefined ? world.settlements[home] : undefined;
      if (!s || s.polityId === undefined) return [];
      const intent = world.currentIntent.get(s.polityId);
      if (!intent) return [];
      // renewed at most yearly — a fresh mandate this year suppresses the re-ask
      const mandate = world.orgMandate.get(s.polityId);
      if (mandate && world.tick - mandate.sinceTick < 350) return [];
      // the org's chosen course + its two strongest alternatives, as the menu
      const chosen = intent.kind;
      const alts = [...intent.alternatives]
        .filter((a) => a.kind !== chosen && a.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      if (alts.length === 0) return [];
      const options: DecisionView['options'] = [
        // hold the org's own course — an explicit mandate for what it already wants
        { label: `Hold to ${intentLabel(chosen)}`, hint: 'affirm the council\'s own course', intent: { kind: 'steer_polity', mode: chosen }, tone: 'neutral' },
        ...alts.map((a) => ({
          label: `Turn to ${intentLabel(a.kind)}`,
          hint: 'bid the polity change course — it heeds you only if it rates the move',
          intent: { kind: 'steer_polity', mode: a.kind },
          tone: 'good' as const,
        })),
      ];
      return [{
        id: `aud:steer:${seasonOf(world)}`,
        urgency: 55,
        prompt: [
          { text: `Your council has set the polity toward ${intentLabel(chosen)}. As its head, do you affirm that course, or turn it?` },
        ],
        options,
      }];
    },
  },

  // ── REACTIVE: someone slighted you this week ────────────────────────────────────────────────
  // A `dispute` event where the player is the wronged party (subjects[1]) and the other party is
  // the instigator (subjects[0]) — a fresh insult demanding an answer. Only the most recent counts.
  {
    id: 'insult',
    evaluate(world, id): DecisionView[] {
      let other: EntityId | undefined;
      let latest = -1;
      for (const eid of world.eventsBySubject.get(id) ?? []) {
        const ev = getEvent(world, eid);
        if (!ev || ev.type !== 'dispute' || ev.tick <= world.tick - WEEK) continue;
        if (ev.subjects[1] !== id) continue; // the player must be the WRONGED party, not the instigator
        const inst = ev.subjects[0];
        if (inst === id || !isAlive(world, inst)) continue;
        if (ev.tick > latest) { latest = ev.tick; other = inst; }
      }
      if (other === undefined) return [];
      return [{
        id: `insult:${other}`,
        urgency: 78,
        prompt: [who(world, other), { text: ' slighted you this week. How do you answer?' }],
        options: [
          { label: 'Strike back', hint: 'a slight for a slight', intent: { kind: 'provoke', target: other, conscience: { axis: 'war', dir: 1 } }, tone: 'bad' },
          { label: 'Offer peace', hint: 'answer the insult with a kindness', intent: { kind: 'give', target: other, conscience: { axis: 'war', dir: -1 } }, tone: 'good' },
          { label: 'Let it pass', hint: 'let the week go by', intent: { kind: 'idle' }, tone: 'neutral' },
        ],
      }];
    },
  },

  // ── REACTIVE: word of a death has reached you ───────────────────────────────────────────────
  // A belief the player FORMED this week that a kinsman is dead — the epistemic layer surfacing as a
  // choice. Responses are real verbs (grief has no verb of its own): seek family, throw yourself into
  // work, or grieve alone.
  {
    id: 'grief',
    evaluate(world, id): DecisionView[] {
      const out: DecisionView[] = [];
      for (const b of world.beliefs.get(id) ?? []) {
        if (b.assertion !== 'dead' || !isKin(world, id, b.subject)) continue;
        const learned = b.evidence[0]?.sinceTick;
        if (learned === undefined || learned <= world.tick - WEEK) continue; // only news of the past week
        const deathEv = b.evidence[0]?.cause !== undefined ? getEvent(world, b.evidence[0].cause) : undefined;
        const delay = deathEv ? Math.max(0, learned - deathEv.tick) : 0;
        const note = delay === 0 ? '' : ` — word reached you ${delay} day${delay === 1 ? '' : 's'} later`;
        const kin = closestLivingKin(world, id, b.subject);
        const options = [
          ...(kin !== undefined
            ? [{ label: 'Seek out family', hint: 'grief shared is grief eased', intent: { kind: 'socialize', target: kin }, tone: 'good' }]
            : []),
          { label: 'Bury yourself in work', hint: 'let labour numb it', intent: { kind: 'work' }, tone: 'neutral' },
          { label: 'Grieve alone', hint: 'let the week pass', intent: { kind: 'idle' }, tone: 'neutral' },
        ];
        out.push({
          id: `grief:${b.subject}`,
          urgency: 88,
          prompt: [{ text: 'You have had word that ' }, who(world, b.subject), { text: ` is dead${note}.` }],
          options,
        });
      }
      return out;
    },
  },

  // ── STANDING: a feud festers ────────────────────────────────────────────────────────────────
  {
    id: 'feud',
    evaluate(world, id): DecisionView[] {
      const foe = strongestFeud(world, id);
      if (foe === undefined || !isAlive(world, foe)) return [];
      return [{
        id: `feud:${foe}`,
        urgency: 70,
        prompt: [{ text: 'Your feud with ' }, who(world, foe), { text: ' festers. What now?' }],
        options: [
          { label: 'Confront them', hint: 'let the enmity out', intent: { kind: 'provoke', target: foe, conscience: { axis: 'war', dir: 1 } }, tone: 'bad' },
          { label: 'Extend an olive branch', hint: 'a kindness can end a feud', intent: { kind: 'give', target: foe, conscience: { axis: 'war', dir: -1 } }, tone: 'good' },
          { label: 'Keep your distance', hint: 'let the week pass', intent: { kind: 'idle' }, tone: 'neutral' },
        ],
      }];
    },
  },

  // ── REACTIVE: a child is born to you ────────────────────────────────────────────────────────
  // A `born` event of the past week where the player is a parent (subjects are [child, bearer,
  // mate]). A commoner's turning point drawn straight from the lifecycle — no new mechanism, just
  // the three generic verbs answering "what does this week become for you?".
  {
    id: 'family_birth',
    evaluate(world, id): DecisionView[] {
      let child: EntityId | undefined;
      let coParent: EntityId | undefined;
      let latest = -1;
      for (const eid of world.eventsBySubject.get(id) ?? []) {
        const ev = getEvent(world, eid);
        if (!ev || ev.type !== 'born' || ev.tick <= world.tick - WEEK) continue;
        if (ev.subjects[0] === id) continue; // the player is the parent here, not the newborn
        if (ev.subjects[1] !== id && ev.subjects[2] !== id) continue; // must be a parent of this child
        const kid = ev.subjects[0];
        if (kid === undefined || !isAlive(world, kid)) continue;
        if (ev.tick > latest) {
          latest = ev.tick;
          child = kid;
          const other = ev.subjects[1] === id ? ev.subjects[2] : ev.subjects[1];
          coParent = other !== undefined && isAlive(world, other) ? other : undefined;
        }
      }
      if (child === undefined) return [];
      return [{
        id: `family_birth:${child}`,
        urgency: 65,
        prompt: [{ text: 'A child, ' }, who(world, child), { text: ', is born to you. How do you meet the week?' }],
        options: [
          ...(coParent !== undefined
            ? [{ label: 'Rejoice with ' + fullName(world, coParent), hint: 'share the joy of it', intent: { kind: 'socialize', target: coParent }, tone: 'good' as const }]
            : []),
          { label: 'Set to providing for them', hint: 'a new mouth — throw yourself into your work', intent: { kind: 'work' }, tone: 'neutral' },
          { label: 'Hold them close', hint: 'let the week be theirs', intent: { kind: 'idle' }, tone: 'good' },
        ],
      }];
    },
  },

  // ── STANDING: a courtship at a crossroads ───────────────────────────────────────────────────
  // A warm, marriageable prospect exists (bestSuitor already gates on eligibility). Lower urgency —
  // an opening, not a crisis.
  {
    id: 'courtship',
    evaluate(world, id): DecisionView[] {
      const suitor = bestSuitor(world, id);
      if (suitor === undefined || !isAlive(world, suitor)) return [];
      return [{
        id: `courtship:${suitor}`,
        urgency: 40,
        prompt: [{ text: 'You have grown fond of ' }, who(world, suitor), { text: '. Do you pursue it?' }],
        options: [
          { label: 'Court them', hint: 'pursue a bond toward marriage', intent: { kind: 'court', target: suitor }, tone: 'good' },
          { label: 'Bide your time', hint: 'let the week pass', intent: { kind: 'idle' }, tone: 'neutral' },
        ],
      }];
    },
  },
];
