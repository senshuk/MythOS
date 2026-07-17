/**
 * PUBLIC VENUES — pack data for design/25 (Close View L4). WHICH venues a settlement
 * raises, WHAT they're called, and WHICH social outcomes happen at which of them are
 * all a universe's vocabulary: this fantasy pack raises a market square, a shrine, a
 * tavern and the ruler's hall; a sci-fi pack might raise a commissary and a docking
 * ring. The ENGINE (engine/venues.ts) only knows the pipeline: mint venues whose
 * condition holds, and stage an event at the first host type present.
 */
import { type Settlement } from '../engine/model';
import { patronDeityOf, hasLeader, leaderTitleOf } from './fixture';
import { venueName } from './languages';

export interface VenueDef {
  /** the Location's locationType — the venue's kind, in this pack's vocabulary. */
  type: string;
  /** does this settlement raise one? (checked at promote; a town can grow into one).
   *  `population` is the settlement's TRUE headcount, supplied by the engine — under
   *  sampled promotion a focused city's macro ledger holds only its remainder. */
  applies(s: Settlement, population: number): boolean;
  /** its durable name (and meaning, when coined in a living tongue). */
  name(s: Settlement, seed: number): { name: string; meaning?: string };
}

export const VENUES: VenueDef[] = [
  {
    type: 'square',
    applies: (_s, population) => population >= 60, // a hamlet has no market
    name: () => ({ name: 'the market square' }),
  },
  {
    type: 'shrine',
    applies: (s) => !!patronDeityOf(s.cultureId),
    name: (s) => ({ name: `the shrine of ${patronDeityOf(s.cultureId)!.name}` }),
  },
  {
    type: 'tavern',
    applies: (_s, population) => population >= 100,
    // the tavern is named in its people's OWN tongue ("Voskhara — 'the bright hearth'")
    name: (s, seed) => venueName(s.cultureId, seed, s.id),
  },
  {
    type: 'hall',
    applies: (s) => hasLeader(s.governmentId),
    name: (s) => ({ name: `the ${leaderTitleOf(s.governmentId).toLowerCase()}'s hall` }),
  },
];

/** Which venue types HOST each social outcome, in preference order — a wedding wants
 *  the shrine before it settles for the square; a brawl starts in the tavern. */
export const VENUE_HOSTS: Record<string, string[]> = {
  married: ['shrine', 'square'],
  friendship: ['tavern', 'square'],
  brawl: ['tavern', 'square'],
  died_brawl: ['tavern', 'square'],
  feud: ['square', 'tavern'],
  // communal gatherings (design/27 §4): a wedding wants the shrine, a funeral the shrine
  // or the square, a feast the square/tavern, a holy-day rite its shrine.
  wedding: ['shrine', 'square', 'tavern'],
  funeral: ['shrine', 'square'],
  feast: ['square', 'tavern'],
  rite: ['shrine', 'square'],
  // audiences (design/26 P2): court is held in the hall; an endowment at the shrine
  judgment: ['hall', 'square'],
  shrine_funding: ['shrine'],
  polity_steered: ['hall', 'square'], // the ruler sets a course from the hall (P4)
};
