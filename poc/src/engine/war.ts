/**
 * Formal WARS between polities (Phase 2E) — a legibility + resolution layer over the
 * edge-level clashes `geographyYearly` already resolves. When a clash escalates to open
 * BATTLE (or a conquest), a named War is declared between the two polities. Allies drawn
 * toward the fight JOIN it by campaign — offense, not merely the defensive weight of the
 * alliance slice — becoming co-belligerents on their friend's side. A war RESOLVES when a
 * primary belligerent falls (its polity dissolved or seat razed → the other side wins and
 * imposes peace on the survivors) or when the fighting guttergs out (a long quiet →
 * stalemate). The war itself moves no armies and razes no town — it names, tracks, and
 * concludes what the world's own war layer does (design/16 principle 5).
 *
 * Deterministic and RNG-FREE: declaration, joining, and resolution are pure records and
 * fixed-rule outcomes drawing nothing from any stream, so a world with no wars is unaffected.
 */
import { type World, type OrgId, type War, DAYS_PER_YEAR } from './model';
import { emit } from './world';
import { getOrganization } from './organization';
import { sealAgreement, activeAgreement } from './orgInteraction';

/** A war peters out into an uneasy peace after this many years without a fresh clash. */
const WAR_QUIET_YEARS = 8;
/** How long a peace imposed by a war's victor stands. */
const IMPOSED_PEACE_YEARS = 15;

const nameOf = (world: World, id: OrgId): string => getOrganization(world, id)?.name ?? 'a fallen power';

/** Is a war's side still standing? A side is alive while its PRIMARY belligerent (side[0])
 *  has a living polity whose seat is not razed. Co-belligerents may fall without ending it. */
function sideAlive(world: World, side: OrgId[]): boolean {
  const primary = getOrganization(world, side[0]);
  if (!primary || primary.dissolvedYear !== undefined || primary.seatId === undefined) return false;
  return world.settlements[primary.seatId]?.ruinedYear === undefined;
}

/** The active war whose PRIMARIES are exactly this pair (either orientation), if any. */
export function warBetween(world: World, x: OrgId, y: OrgId): War | undefined {
  return world.wars.find(
    (w) => (w.sideA[0] === x && w.sideB[0] === y) || (w.sideA[0] === y && w.sideB[0] === x),
  );
}

/** Every active war a polity is a belligerent in (either side). */
export function activeWarsOf(world: World, polityId: OrgId): War[] {
  return world.wars.filter((w) => w.sideA.includes(polityId) || w.sideB.includes(polityId));
}

/**
 * Declare a war between two polities, or continue the one already raging between them. The
 * aggressor leads side A, the defender side B. Returns the war so callers can enrol allies.
 * Declaration is a pure record (no RNG, no relation change) — invariant 8: only the OUTCOME
 * (the clash that caused it) and this named turning point are history.
 */
export function declareOrContinueWar(world: World, aggressor: OrgId, defender: OrgId): War | undefined {
  if (aggressor === defender) return undefined;
  const existing = warBetween(world, aggressor, defender);
  if (existing) {
    existing.lastClashTick = world.tick;
    return existing;
  }
  const war: War = {
    id: world.nextEntityId++,
    sideA: [aggressor],
    sideB: [defender],
    startTick: world.tick,
    lastClashTick: world.tick,
  };
  world.wars.push(war);
  emit(world, 'war_declared', [], { aggressor: nameOf(world, aggressor), defender: nameOf(world, defender) }, [], seatsOf(world, [aggressor, defender]));
  return war;
}

/** Enrol an ally as a co-belligerent on the side of `friend` (already a belligerent). No-op if
 *  the ally is already in the war on either side (you cannot join a fight you are already in). */
export function joinWar(world: World, war: War, ally: OrgId, friend: OrgId): void {
  if (war.sideA.includes(ally) || war.sideB.includes(ally)) return;
  const side = war.sideA.includes(friend) ? war.sideA : war.sideB.includes(friend) ? war.sideB : undefined;
  if (!side) return;
  side.push(ally);
  emit(world, 'war_joined', [], { ally: nameOf(world, ally), friend: nameOf(world, friend) }, [], seatsOf(world, [ally]));
}

/** The seat settlement ids of a set of polities — for anchoring events on the map. */
function seatsOf(world: World, orgs: OrgId[]): number[] {
  const out: number[] = [];
  for (const o of orgs) {
    const seat = getOrganization(world, o)?.seatId;
    if (seat !== undefined) out.push(seat);
  }
  return out;
}

/**
 * Yearly: resolve wars. A war whose primary belligerent has fallen is decided — the standing
 * side wins and imposes a non-aggression peace on each surviving loser (the defeated sue for
 * peace); a war gone long-quiet gutters out in a stalemate. Ended wars are removed (their
 * declared/joined/ended events remain as history). RNG-free.
 */
export function warYearly(world: World): void {
  if (!world.wars.length) return;
  const surviving: War[] = [];
  for (const war of world.wars) {
    const aAlive = sideAlive(world, war.sideA);
    const bAlive = sideAlive(world, war.sideB);
    if (!aAlive || !bAlive) {
      const victors = aAlive ? war.sideA : war.sideB;
      const losers = aAlive ? war.sideB : war.sideA;
      endWar(world, war, victors, losers);
      continue;
    }
    if ((world.tick - war.lastClashTick) / DAYS_PER_YEAR >= WAR_QUIET_YEARS) {
      emit(world, 'war_ended', [], { outcome: 'stalemate', a: nameOf(world, war.sideA[0]), b: nameOf(world, war.sideB[0]) }, [], seatsOf(world, [war.sideA[0], war.sideB[0]]));
      continue;
    }
    surviving.push(war);
  }
  world.wars = surviving;
}

/** Conclude a war with a victor: record it, and let the victor impose a peace on every loser
 *  still standing (a razed loser needs no terms — it is already gone). RNG-free. */
function endWar(world: World, war: War, victors: OrgId[], losers: OrgId[]): void {
  const victor = victors[0];
  emit(world, 'war_ended', [], { outcome: 'victory', victor: nameOf(world, victor), loser: nameOf(world, war.sideA[0] === victor ? war.sideB[0] : war.sideA[0]) }, [], seatsOf(world, [victor]));
  for (const loser of losers) {
    const lo = getOrganization(world, loser);
    if (!lo || lo.dissolvedYear !== undefined || lo.seatId === undefined) continue; // already fallen
    if (world.settlements[lo.seatId]?.ruinedYear !== undefined) continue;
    if (activeAgreement(world, 'non_aggression', victor, loser) === undefined) {
      sealAgreement(world, 'non_aggression', victor, loser, IMPOSED_PEACE_YEARS); // the defeated sue for peace
    }
  }
}
