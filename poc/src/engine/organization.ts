/**
 * Organizations: the engine's first-class collective entities (constitution `design/11`,
 * `design/12`). An Organization is the enduring actor of civilization — a kingdom, guild,
 * church, company, fleet — that acts through a governance structure and outlives its
 * members and the places it occupies.
 *
 * Phase 2A scope — Organizations EXIST. This module is their single home: creation, the
 * registry, and the small read API. An org here has identity, a category, governance (a
 * leader), a seat (a Location, with a history of past seats), reputation (reused from
 * reputation.ts — orgs share the entity id space, so no new reputation code), and a
 * history (events — any id can be an event subject). It does NOT yet hold goals, a
 * treasury, or relationships; those are later stages (2C+).
 *
 * The first concrete instance is the POLITY: the government a settlement HOSTS. The
 * settlement is the place; the polity is the government seated there. Succession operates
 * on the org (figures.ts updates the org's leader). Determinism: orgs are created in a
 * fixed order (settlement-founding order) and draw ids from the shared monotonic stream.
 */
import {
  type World,
  type Organization,
  type OrgId,
  type OrgCategory,
  type Settlement,
  type LocationId,
  type FigureId,
  type EntityId,
  DAYS_PER_YEAR,
} from './model';
import { emit } from './world';
import { getLocation } from './location';
import { POLITY_LABELS, ORG_CATEGORY_POLITICAL } from '../content/fixture';

// ---- registry --------------------------------------------------------------

/** Register an existing Organization object in the id index (used by load). */
export function registerOrganization(world: World, org: Organization): void {
  world.organizationsById.set(org.id, org);
}

/** Rebuild `world.organizationsById` from `world.organizations` (after a load). */
export function rebuildOrgIndex(world: World): void {
  world.organizationsById = new Map();
  for (const org of world.organizations) world.organizationsById.set(org.id, org);
}

export function getOrganization(world: World, id: OrgId | undefined): Organization | undefined {
  if (id === undefined) return undefined;
  return world.organizationsById.get(id);
}

export interface OrgProps {
  name: string;
  category: OrgCategory;
  subtype: string;
  governanceId: string;
  foundedYear: number;
  leaderId?: FigureId;
  seatId?: LocationId;
}

/** Create a generic Organization, allocating a fresh id from the shared entity stream. */
export function createOrganization(world: World, p: OrgProps): OrgId {
  const id: OrgId = world.nextEntityId++;
  const org: Organization = {
    id,
    name: p.name,
    category: p.category,
    subtype: p.subtype,
    foundedYear: p.foundedYear,
    governanceId: p.governanceId,
    leaderId: p.leaderId,
    seatId: p.seatId,
    seatHistory: p.seatId !== undefined ? [p.seatId] : [],
  };
  world.organizations.push(org);
  registerOrganization(world, org);
  return id;
}

// ---- the Polity instance ---------------------------------------------------

/**
 * Found the POLITY a settlement hosts — the first concrete Organization. Its governance
 * is the settlement's government, its leader the current ruler, its seat the settlement
 * Location. Sets `settlement.polityId` and emits `polity_founded`. Returns the new org id.
 */
export function foundPolity(world: World, s: Settlement, year: number): OrgId {
  const seatName = s.name;
  const label = POLITY_LABELS[s.governmentId] ?? 'Polity';
  const id = createOrganization(world, {
    name: `${label} of ${seatName}`,
    category: ORG_CATEGORY_POLITICAL,
    subtype: label.toLowerCase(),
    governanceId: s.governmentId,
    foundedYear: year,
    leaderId: s.currentRulerId,
    seatId: s.id,
  });
  s.polityId = id;
  emit(world, 'polity_founded', [id], { name: world.organizationsById.get(id)!.name, seat: seatName }, [], [s.id]);
  return id;
}

// ---- read API + lifecycle --------------------------------------------------

/**
 * The members of an organization — DERIVED, not stored (no list to keep in sync). For a
 * polity, its members are the residents of its seat (live actors whose home is the seat).
 * The anonymous aggregate population is not enumerated here; this returns the simulated
 * members the engine can name.
 */
export function membersOf(world: World, orgId: OrgId): EntityId[] {
  const org = world.organizationsById.get(orgId);
  if (!org || org.seatId === undefined) return [];
  const out: EntityId[] = [];
  for (const id of world.entities) {
    if (world.homeSettlement.get(id) === org.seatId) out.push(id);
  }
  return out;
}

/** Set (or clear) the figure who speaks for an organization. Used by succession. */
export function setLeader(world: World, orgId: OrgId | undefined, figureId: FigureId | undefined): void {
  const org = getOrganization(world, orgId);
  if (org) org.leaderId = figureId;
}

/**
 * Move an organization's seat to another Location, recording the old seat in its history
 * — so a moved capital leaves a coherent trail and the org's identity is independent of
 * geography. No engine system calls this yet; it proves the abstraction (and 2E will use
 * it). A no-op if the seat is unchanged.
 */
export function moveSeat(world: World, orgId: OrgId, locationId: LocationId): void {
  const org = getOrganization(world, orgId);
  if (!org || org.seatId === locationId) return;
  if (!getLocation(world, locationId)) throw new Error(`moveSeat: location ${locationId} does not exist`);
  org.seatId = locationId;
  org.seatHistory.push(locationId);
}

/** Dissolve an organization (seat razed / membership lost). It keeps its id and history,
 *  like a ruin. A no-op if already dissolved. */
export function dissolve(world: World, orgId: OrgId | undefined, year: number): void {
  const org = getOrganization(world, orgId);
  if (!org || org.dissolvedYear !== undefined) return;
  org.dissolvedYear = year;
  emit(world, 'polity_dissolved', [org.id], { name: org.name });
}

/** The current year, for callers that need it (mirrors figures.ts's derivation). */
export function currentYear(world: World): number {
  return Math.floor(world.tick / DAYS_PER_YEAR);
}
