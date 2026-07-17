/**
 * The Chronicle — the world's memory. Each year, notable events are scored by
 * `interest` (memorability) and added to a bounded set; old tales fade unless
 * they were momentous. The chronicle then feeds two worldbuilding consumers:
 * **named years** ("the Year of Famine in Stonereach") and **legends** ("Folk
 * still tell of how…"). History becomes content. (The RimWorld Tale idea, kept
 * deterministic — interest is a pure function of the event, no RNG.)
 */
import { type World, type WorldEvent, type Tale, type EntityId, type EventId, DAYS_PER_YEAR } from './model';
import { fullName, emit } from './world';
import { endHouseAt } from './figures';
import { renderEvent } from './render';
import { Rng, mixSeed } from './rng';
import { expand } from './grammar';
import { eventInterest, LANDMARK_TYPES, LEGEND_GRAMMAR, ERA_GRAMMAR, ERA_SYMBOL, driftSpecsFor } from './pack';
import { baseAssertion, computeBelief, driftVariant } from './belief';

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

// ------------------------------------------- a culture's own history (design/30 §4.1) ---

/** The version of an event a people currently tell: which assertion they hold, about whom, and
 *  how collectively sure they are of it. */
export interface CultureLegend {
  assertion: string;
  subject: EntityId;
  confidence: number;
}

/**
 * How the people of `cultureId` currently tell each of `eventIds` — the beliefs THEY hold, which
 * past Legend Drift need not be what actually happened.
 *
 * DERIVED, never stored, and reduced from the culture's living members exactly as `orgBeliefOf`
 * reduces an institution's belief from its own: subjectivity exists only where agency exists, so
 * a culture with no simulated actors tells no version at all (an empty map) and the objective
 * record stands. Of the versions its people hold, the one they most collectively affirm wins — a
 * legend is what a folk generally say, not what any one of them says.
 *
 * BATCHED on purpose: the annals ask about a dozen events at once, and this is a live read on the
 * snapshot path (every worker advance step). One pass over the culture's members answers all of
 * them; asking per-event would re-walk every belief a dozen times over.
 *
 * Pure read: touches no world state, gives the culture no evidence stack of its own.
 */
export function cultureLegends(
  world: World,
  cultureId: string,
  eventIds: Set<EventId>,
): Map<EventId, CultureLegend> {
  // eventId → assertion → the running sum of member confidence in that version
  const held = new Map<EventId, Map<string, { subject: EntityId; sum: number }>>();
  let people = 0;
  for (const id of world.entities) {
    const sid = world.homeSettlement.get(id);
    if (sid === undefined || world.settlements[sid]?.cultureId !== cultureId) continue;
    if (!world.personality.get(id)) continue; // a simulated resident — a subject that can know
    people++;
    for (const b of world.beliefs.get(id) ?? []) {
      const state = computeBelief(b, world.tick);
      if (state.stance !== 'true') continue; // only what they affirm is something they'd tell
      // every asked-about event this belief traces back to, however far it has since drifted
      for (const e of b.evidence) {
        if (e.cause === undefined || !eventIds.has(e.cause)) continue;
        let byAssertion = held.get(e.cause);
        if (!byAssertion) held.set(e.cause, (byAssertion = new Map()));
        const row = byAssertion.get(b.assertion) ?? { subject: b.subject, sum: 0 };
        row.sum += state.confidence;
        byAssertion.set(b.assertion, row);
        break; // one vote per belief per event, however many evidence rows point back to it
      }
    }
  }
  const out = new Map<EventId, CultureLegend>();
  if (people === 0) return out; // no subjects → no subjectivity → no folk version

  for (const [eventId, byAssertion] of held) {
    let best: CultureLegend | undefined;
    for (const [assertion, row] of byAssertion) {
      const confidence = row.sum / people;
      if (!best || confidence > best.confidence) best = { assertion, subject: row.subject, confidence };
    }
    if (best) out.set(eventId, best);
  }
  return out;
}

/** The single-event read, for callers who want just one. Prefer `cultureLegends` on any path that
 *  asks about several — this is that, for a set of one. */
export function cultureLegendOf(world: World, cultureId: string, ev: WorldEvent): CultureLegend | undefined {
  return cultureLegends(world, cultureId, new Set([ev.id])).get(ev.id);
}

/**
 * Re-narrate a tale as the holder of `legend` tells it — the rendering half, split from the reading
 * half so the snapshot path can batch the reads (`cultureLegends`) and still render one at a time.
 * Where the legend is a DRIFTED version, that is what gets told; where it is absent, or the plain
 * truth, this is exactly `renderLegend`.
 *
 * The grammar draw is seeded identically to `renderLegend`, so a people's telling differs from its
 * neighbours' in WHAT IS CLAIMED, not in incidental phrasing — the divergence you read is the
 * drift, not the dice.
 */
export function renderLegendAs(world: World, ev: WorldEvent, legend: CultureLegend | undefined): string {
  const variant = legend && driftVariant(legend.assertion);
  if (!legend || variant === undefined) return renderLegend(world, ev);
  const spec = driftSpecsFor(baseAssertion(legend.assertion)).find((s) => s.id === variant);
  if (!spec) return renderLegend(world, ev); // a version this pack no longer defines — tell it straight
  const rng = new Rng(mixSeed(world.seed, ev.id, 0x1ee));
  return expand(LEGEND_GRAMMAR, 'legend', rng, { event: `${fullName(world, legend.subject)} ${spec.label}` });
}

/** Re-narrate a tale as the people of `cultureId` tell it. */
export function renderLegendFor(world: World, ev: WorldEvent, cultureId: string): string {
  return renderLegendAs(world, ev, cultureLegendOf(world, cultureId, ev));
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
