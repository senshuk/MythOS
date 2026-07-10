/**
 * Organizations: the engine's first-class collective entities (constitution `design/11`,
 * `design/12`). An Organization is the enduring actor of civilization — a kingdom, guild,
 * church, company, fleet — that acts through a governance structure and outlives its
 * members and the places it occupies.
 *
 * Phase 2A/2B — Organizations EXIST and REMEMBER. This module is their single home:
 * creation, the registry, the read API, and the membership roster (institutional memory).
 * An org has identity, a category, governance (a leader), a seat (a Location, with a
 * history of past seats), reputation (reused from reputation.ts — orgs share the entity
 * id space, so no new reputation code), and a history (events — any id can be an event
 * subject).
 *
 * Phase 2C — Organizations OWN and RELATE (reasoning lives in orgReason.ts; execution in
 * orgAction.ts):
 *  - The TREASURY (`world.orgTreasury`, kept OFF the identity-locked record like
 *    operationalState) is filled by a yearly tithe on the seat's economy — a real
 *    transfer, never minted (`orgTitheYearly`) — and spent by the ACTION layer: an
 *    action's 'treasury' effects debit it, so what a polity does is bounded by what it
 *    has actually collected.
 *  - RELATIONSHIPS reuse the actor thought machinery: each org gets a `world.rels` map,
 *    and raids/battles/trade sow org-scale thoughts (lod.ts) whose summed opinion is an
 *    institutional grudge or trust that OUTLIVES the people who caused it.
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
  type OrgMember,
  type Settlement,
  type LocationId,
  type FigureId,
  type EntityId,
  type RelEdge,
  DAYS_PER_YEAR,
} from './model';
import { emit, getRel } from './world';
import { getLocation } from './location';
import { addThought, computeOpinion, pruneThoughts } from './opinion';
import { POLITY_LABELS, ORG_CATEGORY_POLITICAL, ORG_ECONOMY, baselineOperational } from './pack';

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
  // orgs RELATE (2C): give the org its adjacency in the shared relationship graph, so
  // getRel works between orgs exactly as between actors (same thought machinery).
  world.rels.set(id, new Map());
  // orgs OWN (2C): an empty treasury, off the identity-locked record (like ops state).
  world.orgTreasury.set(id, 0);
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
  // seed the org's baseline operational condition (strength/readiness/morale).
  world.operationalState.set(id, baselineOperational());
  // institutional memory: the founder is recorded as both founder and first leader.
  if (s.currentRulerId !== undefined) {
    enroll(world, id, s.currentRulerId, ROLE_FOUNDER);
    enroll(world, id, s.currentRulerId, ROLE_LEADER);
  }
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
  closeRoster(world, org.id); // the institution ends — all open roles close, but are remembered
  emit(world, 'polity_dissolved', [org.id], { name: org.name });
}

/** The current year, for callers that need it (mirrors figures.ts's derivation). */
export function currentYear(world: World): number {
  return Math.floor(world.tick / DAYS_PER_YEAR);
}

// ---- membership & roles (institutional memory, Phase 2B) -------------------
//
// The org REMEMBERS its notable members by role. Records are CLOSED (untilTick), not
// deleted, when a role ends — so the roster is a legible history ("who has led this
// polity, and when"). The 'leader' role is the head office; 'founder' marks the founder.
// Roles are open strings (structural defaults below; a guild could mint 'master'). Bulk
// population stays DERIVED via membersOf — only meaningful roles are recorded here.

export const ROLE_LEADER = 'leader';
export const ROLE_FOUNDER = 'founder';

/** The org's roster array, created on first use. */
function roster(world: World, orgId: OrgId): OrgMember[] {
  let list = world.orgMembers.get(orgId);
  if (!list) {
    list = [];
    world.orgMembers.set(orgId, list);
  }
  return list;
}

/** Enrol an actor in an organization under a role, effective now. Appends a record;
 *  does not check for duplicates (a founder is both 'founder' and 'leader', say). */
export function enroll(world: World, orgId: OrgId, actorId: EntityId, role: string): void {
  roster(world, orgId).push({ actorId, role, sinceTick: world.tick });
}

/** Close every currently-open record of `role` (optionally only for `actorId`), recording
 *  that the role ended now. The records remain — the org remembers them. */
export function vacateRole(world: World, orgId: OrgId, role: string, actorId?: EntityId): void {
  const list = world.orgMembers.get(orgId);
  if (!list) return;
  for (const m of list) {
    if (m.role === role && m.untilTick === undefined && (actorId === undefined || m.actorId === actorId)) {
      m.untilTick = world.tick;
    }
  }
}

/** Install a new leader: close the previous 'leader' record, open a fresh one, and mirror
 *  the org's `leaderId`. The single entry point succession uses, so the roster and the
 *  convenience leaderId never diverge. */
export function appointLeader(world: World, orgId: OrgId | undefined, actorId: FigureId | undefined): void {
  const org = getOrganization(world, orgId);
  if (!org) return;
  vacateRole(world, org.id, ROLE_LEADER);
  if (actorId !== undefined) enroll(world, org.id, actorId, ROLE_LEADER);
  org.leaderId = actorId;
}

/** Records of a role on an org. By default only CURRENTLY-held; pass includeClosed for the
 *  full history (ordered as recorded, i.e. by sinceTick). */
export function membersWithRole(world: World, orgId: OrgId, role: string, includeClosed = false): OrgMember[] {
  const list = world.orgMembers.get(orgId) ?? [];
  return list.filter((m) => m.role === role && (includeClosed || m.untilTick === undefined));
}

/** The full line of holders of a role over time (current + past), in order held. */
export function roleHistory(world: World, orgId: OrgId, role: string): OrgMember[] {
  return membersWithRole(world, orgId, role, true);
}

/** All currently-open membership records on an org (any role). */
export function currentMembers(world: World, orgId: OrgId): OrgMember[] {
  return (world.orgMembers.get(orgId) ?? []).filter((m) => m.untilTick === undefined);
}

/** Close every open record on an org (used when it dissolves — the institution ends). */
export function closeRoster(world: World, orgId: OrgId): void {
  const list = world.orgMembers.get(orgId);
  if (!list) return;
  for (const m of list) if (m.untilTick === undefined) m.untilTick = world.tick;
}

// ---- historical queries (read the roster as institutional memory) ----------
//
// These answer "who held what, when" purely from the stored roster — no special-case
// code per question. A record covers tick t when sinceTick <= t AND (it is still open OR
// t < untilTick): held-at is inclusive of the start, exclusive of the end, so a handover
// tick belongs to the successor (matching how appointLeader closes/opens at the same tick).

/** Did membership record `m` cover tick `t`? */
function coversTick(m: OrgMember, t: number): boolean {
  return m.sinceTick <= t && (m.untilTick === undefined || t < m.untilTick);
}

/** Who held `role` in this org at `tick`? (May be several for a multi-seat role; for a
 *  singular role like leader, zero or one.) "Who ruled this kingdom 300 years ago?" */
export function holderAt(world: World, orgId: OrgId, role: string, tick: number): EntityId[] {
  const list = world.orgMembers.get(orgId) ?? [];
  return list.filter((m) => m.role === role && coversTick(m, tick)).map((m) => m.actorId);
}

/** The leader of this org at `tick`, or undefined if none held the seat then. */
export function leaderAt(world: World, orgId: OrgId, tick: number): EntityId | undefined {
  return holderAt(world, orgId, ROLE_LEADER, tick)[0];
}

/** Everyone who has EVER held a role in this org (distinct actor ids), in first-seen order.
 *  "Who has ever belonged to this organization?" */
export function membershipOf(world: World, orgId: OrgId): EntityId[] {
  const seen = new Set<EntityId>();
  const out: EntityId[] = [];
  for (const m of world.orgMembers.get(orgId) ?? []) {
    if (!seen.has(m.actorId)) {
      seen.add(m.actorId);
      out.push(m.actorId);
    }
  }
  return out;
}

/** Every (org, role) an actor has served in, across all organizations — the reverse of the
 *  roster. "Which organizations has this actor served?" O(total records); fine for queries. */
export function organizationsServedBy(world: World, actorId: EntityId): { orgId: OrgId; role: string; sinceTick: number; untilTick?: number }[] {
  const out: { orgId: OrgId; role: string; sinceTick: number; untilTick?: number }[] = [];
  for (const org of world.organizations) {
    for (const m of world.orgMembers.get(org.id) ?? []) {
      if (m.actorId === actorId) out.push({ orgId: org.id, role: m.role, sinceTick: m.sinceTick, untilTick: m.untilTick });
    }
  }
  return out;
}

// ---- the treasury (Phase 2C: organizations OWN) ------------------------------
//
// Institutional funds, kept in `world.orgTreasury` (OFF the identity-locked record, the
// same pattern as operationalState). What an org WANTS is orgReason.ts's business; what
// it can AFFORD is this module's: the tithe fills the treasury, and the action layer's
// 'treasury' effects (orgAction.ts applyEffects) spend it.

/** The settlement an org is seated at, if its seat is a live settlement. */
export function seatSettlement(world: World, org: Organization): Settlement | undefined {
  if (org.seatId === undefined) return undefined;
  const s = world.settlements[org.seatId];
  return s && s.id === org.seatId && s.ruinedYear === undefined ? s : undefined;
}

/** The org's current funds (0 if it has never collected — e.g. loaded from an old save). */
export function treasuryOf(world: World, orgId: OrgId): number {
  return world.orgTreasury.get(orgId) ?? 0;
}

/** Credit (or debit, negative delta) an org's treasury, floored at zero. */
export function adjustTreasury(world: World, orgId: OrgId, delta: number): void {
  world.orgTreasury.set(orgId, Math.max(0, treasuryOf(world, orgId) + delta));
}

/**
 * Yearly: each living, seated polity draws its TITHE — a pack-set fraction of its seat's
 * wealth moves into the org treasury. A real TRANSFER (the seat's economy is debited),
 * never minted; RNG-free, so this pass never perturbs any stream. Runs before the
 * reasoning/action passes, so what an org can afford this year reflects this year's take.
 */
export function orgTitheYearly(world: World): void {
  for (const org of world.organizations) {
    if (org.dissolvedYear !== undefined) continue;
    const seat = seatSettlement(world, org);
    if (!seat || seat.macro.population <= 0) continue;
    const tithe = seat.econ.wealth * ORG_ECONOMY.titheRate;
    seat.econ.wealth -= tithe;
    adjustTreasury(world, org.id, tithe);
  }
}

// ---- relationships (Phase 2C: organizations RELATE) -------------------------
//
// Orgs reuse the actor thought machinery on the SAME shared relationship graph: an edge
// between two org ids carries decaying, sourced thoughts whose sum is the institutional
// stance. The edge is symmetric (one object, both directions) — a raid poisons the PAIR,
// which reads true: blood spilled between two peoples estranges both courts.

/** The relationship edge between two organizations (lazily created, like actors'). */
export function orgRel(world: World, a: OrgId, b: OrgId): RelEdge {
  // defensive: an org loaded from an older save may predate org adjacency maps.
  if (!world.rels.has(a)) world.rels.set(a, new Map());
  if (!world.rels.has(b)) world.rels.set(b, new Map());
  return getRel(world, a, b);
}

/** The summed institutional stance of org a toward org b (symmetric). */
export function orgOpinionOf(world: World, a: OrgId, b: OrgId): number {
  const inner = world.rels.get(a);
  const edge = inner?.get(b);
  return edge ? computeOpinion(edge, world.tick) : 0;
}

/** Sow an org-scale thought between two polities (a raid, a battle, a flourishing trade).
 *  Prunes expired thoughts on the way in, so org edges stay bounded like actors'. */
export function noteOrgThought(world: World, a: OrgId, b: OrgId, kind: string, cause?: number): void {
  const edge = orgRel(world, a, b);
  pruneThoughts(edge, world.tick);
  addThought(edge, kind, world.tick, { cause });
}

