/**
 * The PACK's narrative layer — this universe's VOCABULARY of events.
 *
 * The engine knows the *structure* of an event (a typed, dated, entity-referencing
 * record) and the *mechanism* of history (emit, causal graph, chronicle/annals
 * retention by interest, legend/era rendering via grammar). It does NOT know what
 * the events MEAN or how they READ — that lives here, in the pack:
 *
 *   - EVENT_RENDER  : how each event type reads as prose (English, medieval flavour).
 *   - eventInterest : how memorable each type is (drives what history keeps).
 *   - the grammars  : how ages are named, legends retold, and wonders/beasts/omens
 *                     coined.
 *
 * A different Universe Pack supplies a different narrative.ts (sci-fi prose, its own
 * memorable events, its own grammars) and the engine is unchanged. Event types are
 * plain strings, so a pack may also introduce entirely new kinds the engine has never
 * heard of — they render and score from the data below, with neutral fallbacks.
 */
import { type GrammarRules } from '../engine/grammar';

/** Renders one event to prose. `n(i)` resolves the i-th subject's name; `d` is the
 *  event's data bag; `subjectCount` is how many subjects it carries. */
export type RenderFn = (n: (i: number) => string, d: Record<string, number | string>, subjectCount: number) => string;

/** How each culture value axis reads in prose (the cultural REASON behind a clash). */
const VALUE_PHRASE: Record<string, string> = {
  honor: 'honor',
  war: 'the ways of war',
  tradition: 'old tradition',
  freedom: 'freedom',
  nature: 'the wild',
  craft: 'the crafts',
};
/** " over the wild" — the cultural reason clause appended to a conflict, if present. */
const overReason = (d: Record<string, number | string>): string =>
  d.reason ? ` over ${VALUE_PHRASE[d.reason as string] ?? d.reason}` : '';

export const EVENT_RENDER: Record<string, RenderFn> = {
  settlement_founded: (n, d, c) =>
    c ? `${d.name} was founded by ${n(0)} with ${d.population} souls.` : `The settlement of ${d.name} was founded with ${d.population} souls.`,
  ascension: (n, d) =>
    `${n(0)}${d.house ? ` of House ${d.house}` : ''} became ${d.title || 'ruler'} of ${d.settlement}.`,
  dynasty: (n, d) =>
    `${n(0)} of House ${d.house} seized ${d.settlement}${d.old ? `, ending the rule of House ${d.old}` : ''}, founding a new dynasty.`,
  house_fallen: (_n, d) => `House ${d.house} fell with ${d.settlement} — its line ended.`,
  ruler_died: (n, d) => `${n(0)}, ${d.title || 'ruler'} of ${d.settlement}, passed away.`,
  prosperity: (_n, d) => `${d.name} enjoyed a prosperous year (now ${d.population} souls).`,
  hardship: (_n, d) => `${d.name} suffered hardship — ${d.toll} souls lost.`,
  milestone: (_n, d) => `${d.name} grew to ${d.population} souls.`,
  figure_passed: (_n, d) => `${d.name}, long remembered in ${d.settlement}, passed away at ${d.age}.`,
  boon: (_n, d) => `${d.kind} blessed ${d.name}.`,
  blight: (_n, d) => `A hard season struck ${d.name} — ${d.toll} lost.`,
  plague: (_n, d) => `Plague swept ${d.name} — ${d.toll} perished.`,
  ruined: (n, d, c) => (c ? `${d.name} fell to ruin under ${n(0)}, its last ruler.` : `${d.name} was abandoned, falling to ruin.`),
  battle: (_n, d) => `${d.a} and ${d.b} clashed in battle${overReason(d)} (${d.aToll} and ${d.bToll} fell).`,
  conquest: (n, d, c) =>
    c ? `${n(0)} of ${d.victor} conquered ${d.fallen}${overReason(d)}, razing it.` : `${d.victor} conquered ${d.fallen}${overReason(d)}, razing it.`,
  wonder: (_n, d) => `${d.wonder} was raised in ${d.name}.`,
  beast: (_n, d) => `${d.beast} ravaged ${d.name} — ${d.toll} slain.`,
  omen: (_n, d) => `Over ${d.name}, ${d.omen} — folk feared dark days.`,
  trade: (_n, d) => `Caravans (${d.goods} in goods) ran between ${d.from} and ${d.to}.`,
  raid: (_n, d) => `${d.raider} raided ${d.victim}${d.toll ? ` (${d.toll} lost)` : ''}${overReason(d)}.`,
  famine: (_n, d) => `Famine struck ${d.name} — ${d.toll} starved.`,
  focus_shift: (_n, d) => `Attention turned from ${d.from} to ${d.to}.`,
  emigrated: (n, d) => `${n(0)} left ${d.from} to settle in ${d.to}.`,
  immigrated: (n, d) => `${n(0)} arrived in ${d.to} from ${d.from}.`,
  born: (n, _d, c) => (c >= 3 ? `${n(0)} was born to ${n(1)} and ${n(2)}.` : `${n(0)} was born to ${n(1)}.`),
  died: (n, d) => `${n(0)} passed away${d.age !== undefined ? `, aged ${d.age}` : ''}${d.settlement ? ` in ${d.settlement}` : ''}.`,
  died_brawl: (n) => `${n(0)} was killed by ${n(1)} in a brawl.`,
  married: (n) => `${n(0)} and ${n(1)} were married.`,
  widowed: (n) => `${n(0)} was widowed.`,
  friendship: (n) => `${n(0)} and ${n(1)} became close friends.`,
  rivalry: (n) => `${n(0)} and ${n(1)} became rivals.`,
  feud: (n) => `A bitter feud broke out between ${n(0)} and ${n(1)}.`,
  dispute: (n) => `${n(0)} and ${n(1)} quarrelled.`,
  kindness: (n) => `${n(0)} did ${n(1)} a kindness.`,
  brawl: (n) => `${n(0)} and ${n(1)} came to blows.`,
  condemned: (n, d) => `${n(0)} was condemned by ${d.deity ?? 'the gods'} for their deed.`,
  apostasy: (n, d) => `${n(0)} renounced their faith in ${d.deity ?? 'the gods'}.`,
  converted: (n, d) => `${n(0)} found faith in ${d.deity ?? 'the gods'}.`,
  contested_succession: (n, d) =>
    `${n(0)} of ${d.newFaction ?? 'the new order'} took power in ${d.settlement}, wresting it from ${d.oldFaction ?? 'the old guard'}${d.axis ? ` in the struggle over ${VALUE_PHRASE[d.axis as string] ?? d.axis}` : ''}.`,
  civil_war: (_n, d) =>
    `${d.winner} seized control of ${d.settlement}, driving out ${d.loser} in open civil war over ${VALUE_PHRASE[d.axis as string] ?? d.axis}.`,
  exile: (n, d) =>
    `${n(0)} of ${d.faction ?? 'the old order'} was expelled from ${d.from} and fled to ${d.to}.`,
};

/**
 * How memorable an event is (pure function of type + data — deterministic). Drives
 * what the Chronicle keeps and the Annals enshrine. Unknown types score 0 (routine).
 */
export function eventInterest(type: string, data: Record<string, number | string>): number {
  const toll = typeof data.toll === 'number' ? data.toll : 0;
  const age = typeof data.age === 'number' ? data.age : 0;
  switch (type) {
    case 'civil_war': return 65; // a community tearing itself apart — rival to conquest in drama
    case 'exile': return 52; // a named expulsion — memorable consequence, below a brawl death
    case 'contested_succession': return 42; // a power shift between factions — between ascension and dynasty
    case 'condemned':
      return 55; // a named divine condemnation is notable but not as grave as a death
    case 'apostasy':
      return 18; // renouncing faith is personal — comparable to a marriage or ascension
    case 'converted':
      return 10; // finding faith is quiet — visible in the recent feed, not the annals
    case 'died_brawl':
      return 72;
    case 'conquest':
      return 64; // one settlement razing another — a landmark of war
    case 'ruined':
      return 62; // a settlement falling is a landmark of the age
    case 'beast':
      return 56;
    case 'wonder':
      return 50; // a great work — a positive landmark
    case 'battle':
      return 44;
    case 'plague':
      return 58 + Math.min(30, toll);
    case 'famine':
      return 48 + Math.min(40, toll);
    case 'blight':
      return 34 + Math.min(24, toll);
    case 'boon':
      return 30;
    case 'feud':
      return 46;
    case 'raid':
      return 28 + Math.min(34, toll * 2);
    case 'settlement_founded':
      return 38;
    case 'ruler_died':
      return 40; // a ruler's passing is remembered
    case 'ascension':
      return 18; // a new ruler rising is minor news
    case 'dynasty':
      return 44; // a new dynasty seizing a seat — a turn of the age
    case 'house_fallen':
      return 48; // a great house ending — long remembered
    case 'figure_passed':
      return 40;
    case 'milestone':
      return 24;
    case 'died':
      return age >= 80 ? 26 : age >= 60 ? 16 : 6; // a long life is remembered
    case 'married':
      return 16;
    case 'prosperity':
      return 12;
    case 'rivalry':
      return 12;
    case 'omen':
      return 16; // a portent — minor, but it stirs the feed
    default:
      return 0; // born, friendship, dispute, kindness, brawl, trade, migration, focus…
  }
}

/** Event types that are permanent landmarks of an age, kept in the Annals forever. */
export const LANDMARK_TYPES = new Set<string>(['settlement_founded', 'ruined', 'conquest', 'wonder']);

// --- Grammars: how this universe names its ages, retells its legends, and coins
//     the names of its wonders, beasts, and omens. ---

/** A legend frame wraps the rendered event ([event]) in varied retelling phrasing. */
export const LEGEND_GRAMMAR: GrammarRules = {
  legend: [
    'Folk still tell of how [event].',
    'It is remembered that [event].',
    'Old songs recall how [event].',
    'They say [event].',
    'In time the tale spread that [event].',
    'The elders speak of the day [event].',
    'A grim ballad recalls how [event].',
    'Children are told how [event].',
    'It passed into legend: [event].',
    'Long after, folk still whispered how [event].',
  ],
};

/** Each kind of defining event has several possible era namings. */
export const ERA_GRAMMAR: GrammarRules = {
  era_famine: ['the Year of Famine in [PLACE]', 'the Hungry Year of [PLACE]', 'the Year [PLACE] Starved'],
  era_slain: ['the Year [VICTIM] was slain', 'the Year [VICTIM] fell', "the Year of [VICTIM]'s Murder"],
  era_raid: ['the Year [RAIDER] raided [VICTIM]', 'the Year [RAIDER] fell upon [VICTIM]', 'the [RAIDER]–[VICTIM] Raids'],
  era_feud: ['the Year the [A]–[B] feud erupted', 'the Year [A] and [B] turned to blood', 'the Year of the [A]–[B] Quarrel'],
  era_founded: ['the Founding of [PLACE]', 'the Year [PLACE] was Raised', 'the First Year of [PLACE]'],
  era_passed: ['the Year [PLACE] passed', 'the Passing of [PLACE]'],
  era_milestone: ['the Year [PLACE] grew great', 'the Flowering of [PLACE]'],
  era_died: ['the Year [VICTIM] died', 'the Year [VICTIM] was laid to rest'],
  era_wed: ['the Year [A] and [B] wed', 'the Year of the [A]–[B] Union'],
  era_plague: ['the Year of Plague in [PLACE]', 'the Plague Year of [PLACE]', 'the Year the Sickness Took [PLACE]'],
  era_blight: ['the Hard Year of [PLACE]', 'the Year [PLACE] Suffered', 'the Lean Year of [PLACE]'],
  era_boon: ['the Golden Year of [PLACE]', 'the Year [PLACE] Prospered', 'the Bright Year of [PLACE]'],
  era_ruined: ['the Fall of [PLACE]', 'the Year [PLACE] Fell to Ruin', 'the Ruin of [PLACE]'],
  era_ruler_died: ['the Death of [VICTIM]', 'the Year [VICTIM] Passed', 'the Mourning of [VICTIM]'],
  era_civil_war: ['the Civil War of [PLACE]', 'the Year [PLACE] Tore Itself Apart', 'the Schism of [PLACE]'],
  era_exile: ['the Exile of [VICTIM]', 'the Year [VICTIM] was Cast Out', 'the Banishment of [VICTIM]'],
  era_conquest: ['the Conquest of [FALLEN]', 'the Year [FALLEN] was Conquered', 'the Sack of [FALLEN]'],
  era_battle: ['the Battle of [PLACE]', 'the Year [PLACE] Met War', 'the Clash at [PLACE]'],
  era_wonder: ['the Raising of [WONDER]', 'the Building of [WONDER]', 'the Year [WONDER] was Made'],
  era_beast: ['the Coming of [BEAST]', 'the Year [BEAST] Attacked', 'the Terror of [BEAST]'],
  era_generic: ['the Year of [TYPE]'],
};

/** Which era-grammar symbol names a year defined by each event type. */
export const ERA_SYMBOL: Record<string, string> = {
  famine: 'era_famine',
  died_brawl: 'era_slain',
  raid: 'era_raid',
  feud: 'era_feud',
  settlement_founded: 'era_founded',
  figure_passed: 'era_passed',
  milestone: 'era_milestone',
  died: 'era_died',
  married: 'era_wed',
  plague: 'era_plague',
  blight: 'era_blight',
  boon: 'era_boon',
  ruined: 'era_ruined',
  ruler_died: 'era_ruler_died',
  civil_war: 'era_civil_war',
  exile: 'era_exile',
  conquest: 'era_conquest',
  battle: 'era_battle',
  wonder: 'era_wonder',
  beast: 'era_beast',
};

/** Names a director-raised great work. */
export const WONDER_GRAMMAR: GrammarRules = {
  wonder: ['the Great [hall] of [PLACE]', 'the [adj] [hall] of [PLACE]', 'the [material] [monument] of [PLACE]'],
  hall: ['Hall', 'Temple', 'Tower', 'Library', 'Spire', 'Citadel', 'Vault'],
  adj: ['Golden', 'Grand', 'Eternal', 'Hallowed', 'High', 'Shining'],
  material: ['Bronze', 'Marble', 'Onyx', 'Crystal', 'Iron', 'Silver'],
  monument: ['Colossus', 'Obelisk', 'Throne', 'Great Bell', 'Gate', 'Archive'],
};

/** Names a director-loosed legendary beast. */
export const BEAST_GRAMMAR: GrammarRules = {
  beast: ['the [badj] [creature]', '[bname] the [epithet]', 'the [badj] [creature]'],
  badj: ['Dread', 'Ancient', 'Black', 'Pale', 'Ravenous', 'Vile', 'Great'],
  creature: ['Wyrm', 'Drake', 'Serpent', 'Beast', 'Terror', 'Hydra', 'Wolf', 'Roc'],
  bname: ['Grimfang', 'Vorrath', 'Skarn', 'Maugrim', 'Ssylith', 'Korgath'],
  epithet: ['Devourer', 'Bloodmaw', 'Shadowmaw', 'the Unending', 'Ironhide', 'the Pale'],
};

/** A director portent (flavour). */
export const OMEN_GRAMMAR: GrammarRules = {
  omen: [
    'a comet streaked the night sky',
    'the sun was swallowed in eclipse',
    'the aurora burned blood-red',
    'two moons rose as one',
    'a calf was born with two heads',
    'the rivers ran red for a day',
    'stars fell like rain',
    'a great silence fell at midday',
  ],
};

/** Names for a bountiful director-blessed year (the `kind` of a `boon` event). */
export const BOONS = ['A bountiful harvest', 'A golden season', 'A time of plenty', 'Fair fortune', 'A mild and giving year'];
