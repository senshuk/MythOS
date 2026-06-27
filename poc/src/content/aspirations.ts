/**
 * The PACK's aspiration ladder — what a person of THIS universe wants out of life, as
 * DATA. The engine (engine/aspiration.ts) evaluates this ordered list and takes the
 * first goal whose `applies` holds; everything universe-specific lives here:
 *
 *   - the SET and ORDER of goals (a humanlike life arc: stay alive → make a living →
 *     find a partner → raise a family → settle grudges → seek standing → belong →
 *     leave a legacy → live quietly),
 *   - the CONDITIONS (read needs by ROLE and species-defined life stages / pair-bonding),
 *   - the LABELS (English prose), and
 *   - which goals are ACHIEVEMENTS (`fulfilled`) vs ongoing states.
 *
 * A Star Trek or Cyberpunk pack would supply a different list (explore, ascend, score
 * the big job, upgrade) WITHOUT touching the engine. Goals are gated by species data
 * (pair-bonding species seek a mate; asexual ones never do), so even within one pack
 * the ladder adapts to who the actor is.
 */
import { type World, type EntityId, type Aspiration, type AspirationDef } from '../engine/model';
import { fullName } from '../engine/world';
import { bestSuitor, strongestFeud, isRuler, canSeekRule } from '../engine/social';
import {
  maturityOf,
  elderhoodOf,
  fertileWindowOf,
  ambitionOf,
  pairBondsFor,
  SUBSISTENCE_NEED,
  WEALTH_NEED,
  SOCIAL_NEED,
} from './fixture';

const need = (w: World, id: EntityId, key: string): number => w.needs.get(id)?.[key] ?? 0;

export const ASPIRATIONS: AspirationDef[] = [
  // stay alive — the subsistence need below its danger line dominates everything
  {
    kind: 'survive',
    applies: (w, id) => need(w, id, SUBSISTENCE_NEED) < 300,
    action: () => 'work',
    label: () => 'Stave off hunger',
  },
  // make a living
  {
    kind: 'prosper',
    applies: (w, id) => need(w, id, WEALTH_NEED) < 250,
    action: () => 'work',
    label: () => 'Build a livelihood',
  },
  // find a partner — pair-bonding species only; asexual ones (who breed alone) skip it
  {
    kind: 'wed',
    applies: (w, id) => {
      const idn = w.identity.get(id);
      const lc = w.lifecycle.get(id);
      const ties = w.ties.get(id);
      return (
        !!idn && !!lc && !!ties &&
        pairBondsFor(idn.speciesId) &&
        lc.ageYears >= maturityOf(idn.speciesId) &&
        ties.spouse === undefined
      );
    },
    target: (w, id) => bestSuitor(w, id),
    action: (t) => (t !== undefined ? 'court' : 'socialize'),
    label: (w, _id, t) => (t !== undefined ? `Win the heart of ${fullName(w, t)}` : 'Find someone to marry'),
    fulfilled: (w, id) => w.ties.get(id)?.spouse !== undefined,
  },
  // raise a family
  {
    kind: 'family',
    applies: (w, id) => {
      const idn = w.identity.get(id);
      const lc = w.lifecycle.get(id);
      const ties = w.ties.get(id);
      return (
        !!idn && !!lc && !!ties &&
        ties.spouse !== undefined &&
        ties.children.length === 0 &&
        lc.ageYears <= fertileWindowOf(idn.speciesId)[1]
      );
    },
    target: (w, id) => w.ties.get(id)?.spouse,
    action: () => 'socialize',
    label: () => 'Start a family',
    fulfilled: (w, id) => (w.ties.get(id)?.children.length ?? 0) > 0,
  },
  // settle a grudge
  {
    kind: 'reconcile',
    applies: (w, id) => strongestFeud(w, id) !== undefined,
    target: (w, id) => strongestFeud(w, id),
    action: () => 'socialize',
    label: (w, _id, t) => `Make peace with ${t !== undefined ? fullName(w, t) : 'someone'}`,
    // genuine reconciliation: the former rival is alive and the feud has cleared (a feud
    // only clears by warming back into friendship — see resolve.ts promote).
    fulfilled: (w, id, t) => {
      if (t === undefined) return false;
      const edge = w.rels.get(id)?.get(t);
      return !!edge && !edge.flags.feud && w.lifecycle.get(t)?.alive === true;
    },
  },
  // seek standing — those whose traits carry a drive to lead, in a polity that HAS a
  // leadership seat, strive for it unless they already hold it (all data-driven)
  {
    kind: 'rule',
    applies: (w, id) => ambitionOf(w.traits.get(id) ?? []) > 0 && canSeekRule(w, id) && !isRuler(w, id),
    action: () => 'work',
    label: (w, id) => {
      const h = w.homeSettlement.get(id);
      const place = h !== undefined ? w.settlements[h]?.name ?? 'the village' : 'the village';
      return `Rise to lead ${place}`;
    },
    fulfilled: (w, id) => isRuler(w, id),
  },
  // belong
  {
    kind: 'belonging',
    applies: (w, id) => need(w, id, SOCIAL_NEED) < 250 || (w.rels.get(id)?.size ?? 0) < 2,
    action: () => 'socialize',
    label: () => 'Find true friends',
  },
  // leave a legacy — the elder's goal
  {
    kind: 'legacy',
    applies: (w, id) => {
      const idn = w.identity.get(id);
      const lc = w.lifecycle.get(id);
      return !!idn && !!lc && lc.ageYears >= elderhoodOf(idn.speciesId);
    },
    action: () => 'socialize',
    label: () => 'Be remembered in the village',
  },
  // a quiet life — the always-true fallback (must be last)
  {
    kind: 'content',
    applies: () => true,
    action: () => 'socialize',
    label: () => 'Live a good and quiet life',
  },
];

/** The quiet-life default, returned when no rung applies or an actor is mid-construction. */
export const DEFAULT_ASPIRATION: Aspiration = { kind: 'content', action: 'socialize' };
