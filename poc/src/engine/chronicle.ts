/**
 * The Chronicle — the world's memory. Each year, notable events are scored by
 * `interest` (memorability) and added to a bounded set; old tales fade unless
 * they were momentous. The chronicle then feeds two worldbuilding consumers:
 * **named years** ("the Year of Famine in Stonereach") and **legends** ("Folk
 * still tell of how…"). History becomes content. (The RimWorld Tale idea, kept
 * deterministic — interest is a pure function of the event, no RNG.)
 */
import { type World, type WorldEvent, type Tale, DAYS_PER_YEAR } from './model';
import { fullName, emit } from './world';
import { endHouseAt } from './figures';
import { renderEvent } from './render';
import { Rng, mixSeed } from './rng';
import { expand } from './grammar';
import { eventInterest, LANDMARK_TYPES, LEGEND_GRAMMAR, ERA_GRAMMAR, ERA_SYMBOL } from './pack';

const MIN_INTEREST = 15; // below this an event isn't worth remembering
const CHRONICLE_LIMIT = 60; // how many tales the world keeps
const FADE_PER_YEAR = 0.6; // memorability lost per year (momentous tales last longer)

/** How memorable is an event? Delegates to the pack's interest weights (the universe
 *  decides what's worth remembering); the engine just consumes the score. */
export function interestOf(ev: WorldEvent): number {
  return eventInterest(ev.type, ev.data);
}

const HISTORIC_THRESHOLD = 38; // interest needed to enter the permanent annals
const ANNALS_LIMIT = 240; // the annals keep the top ~N momentous events of all time

/** Yearly: record any new ruins, then fold notable events into the rolling
 *  Chronicle (fading) and the permanent Annals (momentous + landmarks). */
export function chronicleYearly(world: World): void {
  recordRuins(world);

  // chronicleCursor is now an event ID (the last one already processed), not an array
  // index — this way the cursor survives compaction (which shifts array indices).
  const startIdx = Math.max(0, world.chronicleCursor + 1 - world.firstEventId);
  for (let i = startIdx; i < world.events.length; i++) {
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
  // store the ID of the last event processed (= last event in buffer right now)
  world.chronicleCursor = world.nextEventId - 1;

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
      const ruinEv = emit(world, 'ruined', subjects, { name: s.name }, [], [s.id]);
      endHouseAt(world, s, year, ruinEv); // the ruling line falls with the city — traceably
    }
  }
}

function fadedScore(t: Tale, year: number): number {
  return t.interest - (year - t.year) * FADE_PER_YEAR;
}

// --------------------------------------------- rendering (grammars are pack data) ---

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
