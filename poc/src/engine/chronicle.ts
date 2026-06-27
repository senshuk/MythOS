/**
 * The Chronicle — the world's memory. Each year, notable events are scored by
 * `interest` (memorability) and added to a bounded set; old tales fade unless
 * they were momentous. The chronicle then feeds two worldbuilding consumers:
 * **named years** ("the Year of Famine in Stonereach") and **legends** ("Folk
 * still tell of how…"). History becomes content. (The RimWorld Tale idea, kept
 * deterministic — interest is a pure function of the event, no RNG.)
 */
import { type World, type WorldEvent, type Tale, type EventType, DAYS_PER_YEAR } from './model';
import { fullName, emit } from './world';
import { renderEvent } from './render';
import { Rng, mixSeed } from './rng';
import { expand, type GrammarRules } from './grammar';

const MIN_INTEREST = 15; // below this an event isn't worth remembering
const CHRONICLE_LIMIT = 60; // how many tales the world keeps
const FADE_PER_YEAR = 0.6; // memorability lost per year (momentous tales last longer)

/** How memorable is an event? Pure function — deterministic. */
export function interestOf(ev: WorldEvent): number {
  const toll = typeof ev.data.toll === 'number' ? ev.data.toll : 0;
  const age = typeof ev.data.age === 'number' ? ev.data.age : 0;
  switch (ev.type) {
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

const HISTORIC_THRESHOLD = 38; // interest needed to enter the permanent annals
const ANNALS_LIMIT = 240; // the annals keep the top ~N momentous events of all time
const LANDMARK_TYPES = new Set<EventType>(['settlement_founded', 'ruined', 'conquest', 'wonder']);

/** Yearly: record any new ruins, then fold notable events into the rolling
 *  Chronicle (fading) and the permanent Annals (momentous + landmarks). */
export function chronicleYearly(world: World): void {
  recordRuins(world);

  for (let i = world.chronicleCursor; i < world.events.length; i++) {
    const ev = world.events[i];
    const interest = interestOf(ev);
    const landmark = LANDMARK_TYPES.has(ev.type);
    if (interest >= MIN_INTEREST) {
      world.chronicle.push({ eventId: ev.id, year: ev.year, tick: ev.tick, interest });
    }
    if (interest >= HISTORIC_THRESHOLD || landmark) {
      world.annals.push({ eventId: ev.id, year: ev.year, tick: ev.tick, interest, landmark });
    }
  }
  world.chronicleCursor = world.events.length;

  // rolling chronicle: prune the *least memorable, most faded* tales (living memory)
  if (world.chronicle.length > CHRONICLE_LIMIT) {
    const yr = Math.floor(world.tick / DAYS_PER_YEAR);
    world.chronicle.sort((a, b) => fadedScore(b, yr) - fadedScore(a, yr));
    world.chronicle.length = CHRONICLE_LIMIT;
  }

  // annals: NO fade. Keep all landmarks (foundings/ruins) forever + the top
  // non-landmark events by raw interest. This is what lets a deep past survive.
  if (world.annals.length > ANNALS_LIMIT) {
    const landmarks = world.annals.filter((t) => t.landmark);
    const rest = world.annals
      .filter((t) => !t.landmark)
      .sort((a, b) => b.interest - a.interest || a.eventId - b.eventId)
      .slice(0, Math.max(0, ANNALS_LIMIT - landmarks.length));
    world.annals = [...landmarks, ...rest];
  }
}

/** Mark settlements that have fallen to ruin (population 0) and remember it. */
function recordRuins(world: World): void {
  const year = Math.floor(world.tick / DAYS_PER_YEAR);
  for (const s of world.settlements) {
    if (s.detailed || s.ruinedYear !== undefined) continue;
    if (s.macro.population <= 0) {
      s.ruinedYear = year;
      // name the last ruler under whom the settlement fell, if any
      const subjects = s.currentRulerId !== undefined ? [s.currentRulerId] : [];
      emit(world, 'ruined', subjects, { name: s.name });
    }
  }
}

function fadedScore(t: Tale, year: number): number {
  return t.interest - (year - t.year) * FADE_PER_YEAR;
}

// ----------------------------------------------------------- rendering -------

// A legend frame wraps the rendered event ([event]) in varied retelling phrasing.
const LEGEND_GRAMMAR: GrammarRules = {
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

// Each kind of defining event has several possible era namings.
const ERA_GRAMMAR: GrammarRules = {
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
  era_conquest: ['the Conquest of [FALLEN]', 'the Year [FALLEN] was Conquered', 'the Sack of [FALLEN]'],
  era_battle: ['the Battle of [PLACE]', 'the Year [PLACE] Met War', 'the Clash at [PLACE]'],
  era_wonder: ['the Raising of [WONDER]', 'the Building of [WONDER]', 'the Year [WONDER] was Made'],
  era_beast: ['the Coming of [BEAST]', 'the Year [BEAST] Attacked', 'the Terror of [BEAST]'],
  era_generic: ['the Year of [TYPE]'],
};

const ERA_SYMBOL: Partial<Record<EventType, string>> = {
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
  conquest: 'era_conquest',
  battle: 'era_battle',
  wonder: 'era_wonder',
  beast: 'era_beast',
};

function stripPeriod(s: string): string {
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

/** Re-narrate a tale's event as a legend (grammar seeded by id => stable variety). */
export function renderLegend(world: World, ev: WorldEvent): string {
  const rng = new Rng(mixSeed(world.seed, ev.id, 0x1ee));
  const event = stripPeriod(renderEvent(world, ev));
  return expand(LEGEND_GRAMMAR, 'legend', rng, { event });
}

/** Give a year its defining name from its single most interesting event. */
export function eraTitle(world: World, ev: WorldEvent): string {
  const n = (i: number) => (ev.subjects[i] !== undefined ? fullName(world, ev.subjects[i]) : 'someone');
  const d = ev.data;
  const bindings: Record<string, string> = {
    VICTIM: ev.type === 'raid' ? String(d.victim ?? n(0)) : n(0),
    A: n(0),
    B: n(1),
    RAIDER: String(d.raider ?? ''),
    FALLEN: String(d.fallen ?? d.name ?? '?'),
    WONDER: String(d.wonder ?? '?'),
    BEAST: String(d.beast ?? '?'),
    PLACE:
      d.name !== undefined
        ? String(d.name)
        : d.settlement !== undefined
          ? String(d.settlement)
          : d.a !== undefined
            ? String(d.a)
            : n(0),
    TYPE: ev.type,
  };
  const rng = new Rng(mixSeed(world.seed, ev.id, 0xe7a));
  return expand(ERA_GRAMMAR, ERA_SYMBOL[ev.type] ?? 'era_generic', rng, bindings);
}
