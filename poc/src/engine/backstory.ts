/**
 * BACKSTORY FACTS — the raw material for a life-story, gathered from an actor's REAL history
 * in the simulation. RimWorld authors backstories by hand; MythOS assembles them from what
 * actually happened: where the actor is of and that place's fate, their lineage's fortune, the
 * notable events of their formative years, their trade and their bent. The ENGINE gathers these
 * universe-neutral facts; the PACK (content/narrative.renderBackstory) renders them in a
 * culture's voice. Pure read of world state — presentation, never hashed or stored.
 */
import type { World, EntityId } from './model';
import { DAYS_PER_YEAR } from './model';
import { getEvent } from './world';
import { personalityOf } from './social';
import { eventInterest, VALUES, type ValueAxis } from './pack';

/** Event types that make a formative backdrop for a childhood — a real era, worth naming. */
const FORMATIVE_TYPES = new Set(['famine', 'plague', 'blight', 'conquest', 'battle', 'raid', 'civil_war', 'prosperity', 'boon', 'wonder', 'beast', 'ruined']);

/** The fortune of an actor's House, read off the lineage record. */
export type HouseFate = 'ruling' | 'fallen' | 'ended' | 'founding' | 'lowborn';
/** The state of the place an actor is of, relative to their life. */
export type PlaceFate = 'razed' | 'founded' | 'ancient' | 'ordinary';

/** A notable event of an actor's formative years, at their place — the era that shaped them. */
export interface BackstoryEra {
  type: string;
  year: number;
  data: Record<string, number | string>;
}

export interface BackstoryFacts {
  given: string;
  house?: string; // the lineage/surname, when the actor belongs to a named House
  houseFate: HouseFate;
  cultureId: string;
  bornYear: number;
  place?: string; // the settlement the actor is of
  placeFate: PlaceFate;
  profession: string;
  dominantValue?: ValueAxis; // the value they lean on hardest — the bent a backstory explains
  era?: BackstoryEra;
  orphaned: boolean;
}

/** Gather the facts of an actor's life from world state. Returns undefined for entities that
 *  are not simulated actors (a minted historical figure has no identity/personality). */
export function backstoryFacts(world: World, id: EntityId): BackstoryFacts | undefined {
  const idn = world.identity.get(id);
  const lc = world.lifecycle.get(id);
  if (!idn || !lc) return undefined;

  const bornYear = Math.floor(lc.bornTick / DAYS_PER_YEAR);
  const homeId = world.homeSettlement.get(id);
  const home = homeId !== undefined ? world.settlements[homeId] : undefined;
  const cultureId = home?.cultureId ?? world.settlements[0]?.cultureId ?? '';

  // LINEAGE — a simulated actor joins its House by surname (there is no houseId on an actor).
  const house = world.houses.find((h) => h.name === idn.family);
  let houseFate: HouseFate = 'lowborn';
  if (house) {
    if (house.founderId === id) houseFate = 'founding';
    else if (house.extinctYear !== undefined) houseFate = 'ended';
    else if (house.seatSettlementId !== undefined) houseFate = 'ruling';
    else houseFate = 'fallen';
  }

  // PLACE — the fate of where they are of, relative to their life.
  let placeFate: PlaceFate = 'ordinary';
  if (home) {
    if (home.ruinedYear !== undefined) placeFate = 'razed';
    else if (home.foundedYear >= bornYear - 4) placeFate = 'founded'; // born as it rose
    else if (bornYear - home.foundedYear >= 140) placeFate = 'ancient';
  }

  // BENT — the value axis they lean on hardest (the trait a backstory ties off with).
  const pers = personalityOf(world, id);
  let dominantValue: ValueAxis | undefined;
  let peak = 26; // a real lean, not noise
  for (const ax of VALUES) {
    const v = Math.abs(pers.values[ax] ?? 0);
    if (v > peak) { peak = v; dominantValue = ax; }
  }

  // ERA — the most notable FORMATIVE event of their youth, at their place (not their own deeds).
  // Only a real backdrop counts (a famine, a war, a golden age) — an ordinary childhood gets no
  // era clause rather than a bland "in the days of yN".
  let era: BackstoryEra | undefined;
  if (homeId !== undefined) {
    let bestScore = -Infinity;
    for (const eid of world.eventsBySettlement.get(homeId) ?? []) {
      const ev = getEvent(world, eid);
      if (!ev || ev.subjects.includes(id) || !FORMATIVE_TYPES.has(ev.type)) continue;
      const near = Math.abs(ev.year - bornYear);
      if (near > 18) continue; // within their childhood/youth
      const score = eventInterest(ev.type, ev.data) - near; // notable AND close
      if (score > bestScore) {
        bestScore = score;
        era = { type: ev.type, year: ev.year, data: ev.data };
      }
    }
  }

  // ORPHANED — both known parents are gone.
  const parents = world.ties.get(id)?.parents ?? [];
  const orphaned = parents.length > 0 && parents.every((p) => !(world.lifecycle.get(p)?.alive ?? false));

  return {
    given: idn.given,
    house: house ? idn.family : undefined,
    houseFate,
    cultureId,
    bornYear,
    place: home?.name,
    placeFate,
    profession: world.profession.get(id) ?? 'wanderer',
    dominantValue,
    era,
    orphaned,
  };
}
