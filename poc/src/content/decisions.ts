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
import { type World, type EntityId, type DecisionDef, type DecisionView, type EventPart } from '../engine/model';
import { fullName, isKin, isAlive, getEvent } from '../engine/world';
import { computeOpinion } from '../engine/opinion';
import { bestSuitor, strongestFeud } from '../engine/social';

/** Days that count as "this week" — one player turn advances exactly this far, so a reactive
 *  decision surfaces the week just lived and is gone by the next. */
const WEEK = 7;

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
          { label: 'Strike back', hint: 'a slight for a slight', intent: { kind: 'provoke', target: other }, tone: 'bad' },
          { label: 'Offer peace', hint: 'answer the insult with a kindness', intent: { kind: 'give', target: other }, tone: 'good' },
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
          { label: 'Confront them', hint: 'let the enmity out', intent: { kind: 'provoke', target: foe }, tone: 'bad' },
          { label: 'Extend an olive branch', hint: 'a kindness can end a feud', intent: { kind: 'give', target: foe }, tone: 'good' },
          { label: 'Keep your distance', hint: 'let the week pass', intent: { kind: 'idle' }, tone: 'neutral' },
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
