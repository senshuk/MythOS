/**
 * OBJECTS AS HISTORICAL AGENTS, v1: dynastic heirlooms (design/33, implementing
 * design/30 §4.2 / design/11 §Object).
 *
 * The engine's half is pure mechanism: MINT an heirloom when a House is founded (a
 * deterministic per-house gate — scarcity at the source), TRANSFER it when its holder's
 * seat falls (seized by a conqueror's house, or lost with no victor to take it), and
 * REDUCE its renown on demand from its own decaying event history. What an object is
 * called, what kinds exist, and how its loss is told (and mis-told — Legend Drift runs
 * on `lost` beliefs) are all the pack's vocabulary.
 *
 * LAWS this file obeys:
 *  - Minting is STREAM-FREE (a per-house Rng seeded from world.seed + house.id, like
 *    venue minting) — adding objects to a build never shifts a world-RNG draw.
 *  - Renown is DERIVED, never stored (design/18): a computed reduction over the
 *    object's event history with per-event recency decay. A blade no event has touched
 *    in generations quietly stops reading as storied — which is itself history
 *    ("the old songs about it stopped being sung"), not a silent flag flip.
 */
import { type World, type WorldObject, type House, type Settlement, type EntityId, DAYS_PER_YEAR } from './model';
import { Rng, mixSeed } from './rng';
import { emit } from './world';
import { perceiveEvent } from './perception';
import { objectName, OBJECT_KINDS } from './pack';

/** Roughly a third of house foundings come with an heirloom — scarcity at the source.
 *  (Renown scarcity is separately enforced by the decaying reducer below; this gate is
 *  about the object POPULATION, so relics stay rare enough to matter.) */
const MINT_CHANCE = 0.34;

/** Renown contributed by each kind of biography event, decaying with years since.
 *  Transfers outweigh the forging: an heirloom is made storied by what befalls it. */
const RENOWN_WEIGHT: Record<string, number> = { object_forged: 12, object_seized: 34, object_lost: 30 };
const RENOWN_HALF_LIFE_YEARS = 60;

/** Mint a founding House's heirloom, maybe — deterministic per (world seed, house id),
 *  drawing NOTHING from any world stream. Named in the founding culture's own tongue,
 *  registered in world.names so prose and drifting legends resolve it forever. */
export function maybeMintHeirloom(world: World, house: House, settlementId: number, year: number, makerName?: string): WorldObject | undefined {
  const rng = new Rng(mixSeed(world.seed, house.id, 0x0b1e));
  if (rng.next() >= MINT_CHANCE) return undefined;
  const s = world.settlements[settlementId];
  if (!s) return undefined;
  const kind = OBJECT_KINDS[rng.int(OBJECT_KINDS.length)];
  const named = objectName(s.cultureId, world.seed, house.id);
  const obj: WorldObject = {
    id: world.nextEntityId++,
    name: named.name,
    nameMeaning: named.meaning,
    kind: kind.id,
    forgedYear: year,
    originSettlementId: settlementId,
    makerName,
    holderHouseId: house.id,
    history: [],
  };
  world.names.set(obj.id, obj.name); // history outlives everything — like a figure's name
  world.objects.push(obj);
  const ev = emit(world, 'object_forged', [obj.id], { object: obj.name, kind: kind.label, house: house.name, settlement: s.name, meaning: named.meaning ?? '' }, [], [settlementId]);
  obj.history.push({ eventId: ev, year, kind: 'object_forged' });
  return obj;
}

/**
 * A fallen House's heirlooms move: SEIZED by the victor's ruling house (plunder is a
 * transfer, and the biography records it), or LOST when the city fell to ruin with no
 * victor — a relic now waiting, somewhere, for a future increment to let it resurface.
 * A loss is BELIEF-WORTHY: focused-settlement witnesses come to hold "it was lost when
 * the city fell," and that assertion drifts through Legend Drift like any other.
 */
export function transferHeirlooms(world: World, fallen: House, settlement: Settlement, year: number, cause?: number, victorHouse?: House): void {
  for (const obj of world.objects) {
    if (obj.holderHouseId !== fallen.id) continue;
    if (victorHouse && victorHouse.extinctYear === undefined) {
      obj.holderHouseId = victorHouse.id;
      const ev = emit(
        world,
        'object_seized',
        [obj.id],
        { object: obj.name, victor: victorHouse.name, fallen: fallen.name, settlement: settlement.name },
        cause !== undefined ? [cause] : [],
        [settlement.id],
      );
      obj.history.push({ eventId: ev, year, kind: 'object_seized' });
      perceiveEvent(world, ev, settlement.id); // locals see the plunder carried off
    } else {
      obj.holderHouseId = undefined;
      const ev = emit(
        world,
        'object_lost',
        [obj.id],
        { object: obj.name, house: fallen.name, settlement: settlement.name },
        cause !== undefined ? [cause] : [],
        [settlement.id],
      );
      obj.history.push({ eventId: ev, year, kind: 'object_lost' });
      perceiveEvent(world, ev, settlement.id); // witnesses hold "it was lost" — and retellings drift
    }
  }
}

/** The heirlooms a House currently holds (usually 0 or 1 in v1). */
export function heirloomsOf(world: World, houseId: number): WorldObject[] {
  return world.objects.filter((o) => o.holderHouseId === houseId);
}

export function objectById(world: World, id: EntityId): WorldObject | undefined {
  return world.objects.find((o) => o.id === id);
}

/** RENOWN — the Law of Mythic Scarcity's reducer (design/18): computed on demand from
 *  the object's own event history, each entry decaying by half every
 *  RENOWN_HALF_LIFE_YEARS. Never stored; never only-increasing. */
export function objectRenown(world: World, obj: WorldObject): number {
  const year = Math.floor(world.tick / DAYS_PER_YEAR);
  let sum = 0;
  for (const h of obj.history) {
    const w = RENOWN_WEIGHT[h.kind] ?? 8;
    sum += w * Math.pow(0.5, Math.max(0, year - h.year) / RENOWN_HALF_LIFE_YEARS);
  }
  return sum;
}

/** The renown TIER a pack's prose can key off — 'plain' | 'storied' | 'legendary'.
 *  Thresholds are deliberately hard to reach and easy to fall from (design/30 §7). */
export function objectRenownTier(world: World, obj: WorldObject): 'plain' | 'storied' | 'legendary' {
  const r = objectRenown(world, obj);
  return r >= 46 ? 'legendary' : r >= 18 ? 'storied' : 'plain';
}
