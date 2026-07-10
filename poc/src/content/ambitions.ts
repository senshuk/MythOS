/**
 * The PACK's AMBITIONS — the long-horizon lives THIS universe lets a player commit to, as DATA. The
 * engine (engine/ambition.ts) owns only the mechanism (offer, commit, review, surface the step);
 * which ambitions exist and how they read is universe-specific and lives here, like the aspiration
 * ladder (content/aspirations.ts) and the decision set (content/decisions.ts).
 *
 * Two disciplines, both load-bearing:
 *   - OFFERS come from the actor's real situation (a feud → "best them"; an unwed adult with a
 *     prospect → "win their hand"), never a fixed menu — legibility and world-before-player.
 *   - The next STEP is GAP-DERIVED: each def inspects the distance between now and `fulfilled` and
 *     surfaces the relevant EXISTING affordance (get closer → socialize; close enough → court). It
 *     is never a scripted stage chain; the obstacles (a cool prospect, a watchful father, a rival)
 *     come from the simulation. Every method is a pure read — an ambition never mutates the world.
 *
 * All steps are composed from the six generic verbs the engine already resolves, so an ambition
 * needs no new resolver code. A richer pack points a step at a pack-specific verb (EXTRA_ACTIONS).
 */
import { type World, type EntityId, type AmbitionDef, type DecisionView } from '../engine/model';
import { fullName, isAlive, canTakeSpouse } from '../engine/world';
import { computeOpinion } from '../engine/opinion';
import { bestSuitor, strongestFeud, isRuler, canSeekRule } from '../engine/social';
import { standingOf } from '../engine/reputation';
// through the PACK BOUNDARY, not './fixture' — this module is reusable mechanism, so its
// species lookups must follow whichever universe is bound (see aspirations.ts).
import { maturityOf, pairBondsFor } from '../engine/pack';

// Narrative warmth thresholds for the courtship step's progress note (pack's own prose gates, not
// the engine's escalation thresholds — those live in systems/resolve.ts).
const WARM = 240;
const READY = 310;
// How decisively the player must out-rank a rival to count as having "bested" them.
const ECLIPSE_MARGIN = 60;

const spousesOf = (w: World, id: EntityId): EntityId[] => w.ties.get(id)?.spouses ?? [];

export const AMBITIONS: AmbitionDef[] = [
  // ── Win a specific heart ────────────────────────────────────────────────────────────────────
  // Offered to an unwed, marriageable adult who already has someone in mind (bestSuitor gates
  // eligibility). Fulfilled by wedding them; thwarted if they die or wed another.
  {
    id: 'marry',
    offerable(w, id) {
      if (!canTakeSpouse(w, id)) return undefined;
      const idn = w.identity.get(id);
      const lc = w.lifecycle.get(id);
      if (!idn || !lc || !pairBondsFor(idn.speciesId) || lc.ageYears < maturityOf(idn.speciesId)) return undefined;
      const t = bestSuitor(w, id);
      return t !== undefined ? { target: t } : undefined;
    },
    label: (w, _id, t) => (t !== undefined ? `Win the hand of ${fullName(w, t)}` : 'Marry well'),
    hint: () => 'court them, warm their heart, and wed',
    note(w, id, t) {
      if (t === undefined) return 'You have no one in mind.';
      if (spousesOf(w, id).includes(t)) return `You are wed to ${fullName(w, t)}.`;
      if (!isAlive(w, t)) return `${fullName(w, t)} is gone.`;
      const edge = w.rels.get(id)?.get(t);
      const op = edge ? computeOpinion(edge, w.tick) : 0;
      const name = fullName(w, t);
      return op >= READY ? `${name} is ready — press your suit.` : op >= WARM ? `${name} is fond of you.` : `${name} barely knows you yet.`;
    },
    nextStep(w, _id, t): DecisionView | undefined {
      if (t === undefined || !isAlive(w, t)) return undefined;
      return {
        id: `amb:marry:${t}`,
        urgency: 100,
        prompt: [{ text: 'To wed ' }, { text: fullName(w, t), ref: { kind: 'actor', id: t } }, { text: ', draw closer.' }],
        options: [
          { label: 'Court them', hint: 'pursue the bond toward marriage', intent: { kind: 'court', target: t }, tone: 'good' },
          { label: 'Spend time together', hint: 'let fondness grow', intent: { kind: 'socialize', target: t }, tone: 'neutral' },
          { label: 'Offer a gift', hint: 'a kindness to warm them', intent: { kind: 'give', target: t }, tone: 'good' },
        ],
      };
    },
    fulfilled: (w, id, t) => t !== undefined && spousesOf(w, id).includes(t),
    impossible(w, id, t) {
      if (t === undefined) return false;
      if (!isAlive(w, t)) return true;
      const ts = spousesOf(w, t);
      return ts.length > 0 && !ts.includes(id); // they wed someone else
    },
  },

  // ── Best a rival ────────────────────────────────────────────────────────────────────────────
  // Offered when the player has a feud. Fulfilled by out-ranking them decisively, or outliving them
  // (their death by any cause counts — you were the one left standing). Never scripted to require a
  // killing; the confront step is one option among honourable ones.
  {
    id: 'rival',
    offerable(w, id) {
      const foe = strongestFeud(w, id);
      return foe !== undefined ? { target: foe } : undefined;
    },
    label: (w, _id, t) => (t !== undefined ? `Best ${fullName(w, t)}` : 'Best your rival'),
    hint: () => 'outshine them — or outlast them',
    note(w, id, t) {
      if (t === undefined) return '';
      if (!isAlive(w, t)) return `${fullName(w, t)} is gone; you outlasted them.`;
      const me = standingOf(w, id);
      const them = standingOf(w, t);
      return me > them + ECLIPSE_MARGIN ? 'You are the better regarded now.' : `${fullName(w, t)} still stands above you.`;
    },
    nextStep(w, _id, t): DecisionView | undefined {
      if (t === undefined || !isAlive(w, t)) return undefined;
      return {
        id: `amb:rival:${t}`,
        urgency: 100,
        prompt: [{ text: 'To best ' }, { text: fullName(w, t), ref: { kind: 'actor', id: t } }, { text: ', how do you move?' }],
        options: [
          { label: 'Outshine them', hint: 'build a name that eclipses theirs', intent: { kind: 'work' }, tone: 'neutral' },
          { label: 'Confront them', hint: 'strike at your rival directly', intent: { kind: 'provoke', target: t }, tone: 'bad' },
        ],
      };
    },
    fulfilled: (w, id, t) => t !== undefined && (!isAlive(w, t) || standingOf(w, id) > standingOf(w, t) + ECLIPSE_MARGIN),
  },

  // ── Rise to lead ────────────────────────────────────────────────────────────────────────────
  // Offered to anyone in a polity that HAS a leadership seat they don't already hold. Fulfilled by
  // taking the seat (an emergent outcome; may remain a lifelong striving — that's an honest arc).
  {
    id: 'rise',
    offerable(w, id) {
      return canSeekRule(w, id) && !isRuler(w, id) ? {} : undefined;
    },
    label(w, id) {
      const h = w.homeSettlement.get(id);
      const place = h !== undefined ? w.settlements[h]?.name ?? 'your home' : 'your home';
      return `Rise to lead ${place}`;
    },
    hint: () => 'make your name until the seat is yours',
    note: (w, id) => (isRuler(w, id) ? 'The seat is yours.' : 'You are not yet the one they look to.'),
    nextStep(w, id): DecisionView {
      const h = w.homeSettlement.get(id);
      const ruler = h !== undefined ? w.settlements[h]?.currentRulerId : undefined;
      const options: DecisionView['options'] = [
        { label: 'Serve the town', hint: 'plain work builds a good name', intent: { kind: 'work' }, tone: 'neutral' },
      ];
      if (ruler !== undefined && ruler !== id && isAlive(w, ruler)) {
        options.push({ label: `Court ${fullName(w, ruler)}'s favor`, hint: 'win over the one who holds the seat', intent: { kind: 'socialize', target: ruler }, tone: 'good' });
      }
      return { id: 'amb:rise', urgency: 90, prompt: [{ text: 'To rise, make yourself known.' }], options };
    },
    fulfilled: (w, id) => isRuler(w, id),
  },
];
