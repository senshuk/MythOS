/**
 * THE MYTHIC FEEDBACK LOOP (design/34, implementing design/30 §4.10): legends act on
 * the world. Legend Drift makes stories change; this file is what makes stories change
 * CIVILIZATIONS — one shared reducer, consumed by three existing systems:
 *
 *   livingLegendsAt()    → the legends a community currently holds (derived, decaying)
 *   legendValueNudge()   → consumer 1: worldviewOf's extra input (culture drift)
 *   (content/ambitions)  → consumer 2: the 'emulate' ambition reads the same reducer
 *   legendOrdersYearly() → consumer 3: a broadly-held legend founds a devotional order
 *
 * LAWS: the reducer is computed on demand from the decaying Belief stacks — never
 * stored (design/18): a legend nobody retells stops being a living legend, and with it
 * the nudge fades and no order can be founded on it. Subjectivity exists only where
 * agency exists (17): aggregate settlements hold no living legends. Everything here is
 * RNG-free — which legends exist, whom they pull, and what gets founded follows only
 * from who told whom.
 */
import { type World, type EntityId, DAYS_PER_YEAR } from './model';
import { computeBelief, baseAssertion, driftVariant } from './belief';
import { emit } from './world';
import { standingOf } from './reputation';
import { objectById, objectRenown } from './objects';
import { createOrganization, enroll, getOrganization, ROLE_FOUNDER, ROLE_LEADER } from './organization';
import {
  LEGEND_THEMES,
  LEGEND_MIN_HOLDERS,
  LEGEND_SATURATION,
  LEGEND_ORDER_HOLDERS,
  ORDER_HOLDER_SHARE,
  ORDER_FOUNDING_COOLDOWN_YEARS,
  ORG_CATEGORY_DEVOTIONAL,
  orderNameFor,
  driftSpecsFor,
  type ValueAxis,
} from './pack';

/** A legend a community currently HOLDS: a drifted assertion about a subject, affirmed
 *  (stance true) by `holders` living residents. `variant` keys the pack's themes. */
export interface LivingLegend {
  subject: EntityId;
  assertion: string;
  variant: string;
  holders: EntityId[];
}

/**
 * The living legends of one settlement — every (subject, drifted assertion) its living
 * residents currently affirm. Pure read over the decaying Belief stacks: as the
 * underlying beliefs decay or their holders die unheard, the legend thins and vanishes.
 */
export function livingLegendsAt(world: World, seatId: number): LivingLegend[] {
  const byKey = new Map<string, LivingLegend>();
  for (const id of world.entities) {
    if (world.homeSettlement.get(id) !== seatId) continue;
    const held = world.beliefs.get(id);
    if (!held) continue;
    for (const b of held) {
      const variant = driftVariant(b.assertion);
      if (variant === undefined) continue; // the plain truth is news, not legend
      if (computeBelief(b, world.tick).stance !== 'true') continue;
      const key = `${b.subject}|${b.assertion}`;
      let lg = byKey.get(key);
      if (!lg) byKey.set(key, (lg = { subject: b.subject, assertion: b.assertion, variant, holders: [] }));
      lg.holders.push(id);
    }
  }
  return [...byKey.values()];
}

/**
 * CONSUMER 1 — culture drift. The value-nudge a community's living legends exert on its
 * collective worldview: each legend past LEGEND_MIN_HOLDERS pulls along its pack-mapped
 * axis, scaled by how broadly it is held (saturating at LEGEND_SATURATION). Applied by
 * worldviewOf ON TOP of the member value mean — the members' innate values are never
 * touched; the drift exists only in the derived reading, exactly like every other
 * collective conclusion in this engine.
 */
export function legendValueNudge(world: World, seatId: number): Partial<Record<ValueAxis, number>> {
  const nudge: Partial<Record<ValueAxis, number>> = {};
  for (const lg of livingLegendsAt(world, seatId)) {
    if (lg.holders.length < LEGEND_MIN_HOLDERS) continue;
    const theme = LEGEND_THEMES[lg.variant];
    if (!theme) continue; // a variant this pack gives no theme moves no one
    const strength = Math.min(1, lg.holders.length / LEGEND_SATURATION);
    nudge[theme.axis] = (nudge[theme.axis] ?? 0) + theme.delta * strength;
  }
  return nudge;
}

/**
 * ATTRACTOR STRENGTH (design/30 §6, via design/34): how much of the world's ambition
 * currently orbits this entity, and for how long it has. The review's "Historical
 * Attractor" answered as the reducer it is — the One Ring and the Iron Throne are not a
 * primitive but the steady state of the feedback loop, and this is the LEGIBILITY read
 * that names it. Pure, stores nothing, decays by construction (its inputs — beliefs,
 * renown, a living order — all decay or dissolve): mythic scarcity holds (design/30 §7).
 * Each part is labelled so "why does this thing matter so much?" has a computed answer.
 */
export interface AttractorReading {
  strength: number;
  parts: { label: string; value: number }[];
}
export function attractorStrength(world: World, subjectId: EntityId): AttractorReading {
  const parts: { label: string; value: number }[] = [];
  const year = Math.floor(world.tick / DAYS_PER_YEAR);

  // souls anywhere who hold a legend of it as true (the belief substrate's world-wide read)
  let believers = 0;
  for (const id of world.entities) {
    for (const b of world.beliefs.get(id) ?? []) {
      if (b.subject !== subjectId || driftVariant(b.assertion) === undefined) continue;
      if (computeBelief(b, world.tick).stance === 'true') { believers++; break; }
    }
  }
  if (believers > 0) parts.push({ label: `${believers} souls hold its legend`, value: believers });

  // institutions sworn to it — weighted by how LONG they have stood (the "six generations")
  for (const o of world.organizations) {
    if (o.legendSubjectId !== subjectId || o.dissolvedYear !== undefined) continue;
    const yrs = Math.max(0, year - o.foundedYear);
    parts.push({ label: `${o.name}, sworn ${yrs} year${yrs === 1 ? '' : 's'}`, value: 12 + Math.min(24, yrs * 0.8) });
  }

  // a living soul currently walking in its steps (the emulate ambition)
  const amb = world.playerAmbition;
  if (amb && amb.id === 'emulate' && amb.target === subjectId && amb.completedTick === undefined) {
    parts.push({ label: 'one walks in its steps', value: 8 });
  }

  // a storied object's own remembered deeds (design/33's decaying renown reducer)
  const obj = objectById(world, subjectId);
  if (obj) {
    const renown = objectRenown(world, obj);
    if (renown > 0) parts.push({ label: 'its remembered deeds', value: renown * 0.5 });
  }

  return { strength: Math.round(parts.reduce((s, p) => s + p.value, 0)), parts };
}

/**
 * CONSUMER 3 — organization founding. A legend held broadly enough founds a DEVOTIONAL
 * order: seated at the settlement, led by its highest-standing believer, named by the
 * pack from the legend's variant ("the Seekers of Wryo"), and remembering the legend
 * that founded it. The founding event's causes run through the founder's own evidence
 * back to the original event — "why does this order exist?" resolves completely.
 * Focused-settlement only by construction (only there do believers exist). RNG-free.
 */
/** The holders a legend needs before it can found an order HERE: the pack floor, or a
 *  real SHARE of the community, whichever is greater — the Law of Mythic Scarcity
 *  (design/30 §7): in a full town a tale must grip a fraction of souls, not a street. */
export function legendOrderThreshold(world: World, seatId: number): number {
  let residents = 0;
  for (const id of world.entities) if (world.homeSettlement.get(id) === seatId) residents++;
  return Math.max(LEGEND_ORDER_HOLDERS, Math.ceil(residents * ORDER_HOLDER_SHARE));
}

export function legendOrdersYearly(world: World): void {
  const seatId = world.focusedSettlementId;
  if (seatId < 0) return;
  const s = world.settlements[seatId];
  if (!s || s.ruinedYear !== undefined) return;
  const year = Math.floor(world.tick / DAYS_PER_YEAR);
  const threshold = legendOrderThreshold(world, seatId);

  // SCARCITY (design/30 §7): a settlement raises at most one order per GENERATION — a
  // founding is a rare turning of the communal soul. Derived from the org records the
  // world already keeps, no new state.
  const lastFounding = world.organizations
    .filter((o) => o.category === ORG_CATEGORY_DEVOTIONAL && o.seatId === seatId)
    .reduce((latest, o) => Math.max(latest, o.foundedYear), -Infinity);
  if (year - lastFounding < ORDER_FOUNDING_COOLDOWN_YEARS) return;

  // Eligibility is judged by SUBJECT, not by exact telling: retelling fragments one tale
  // into variants, and a community gripped by the story of X across three versions is
  // still gripped by the story of X. The order swears to the DOMINANT telling. And at
  // most ONE founding per year even then — the tale that grips the most souls wins
  // (deterministic tiebreak by subject); live play showed a lively town otherwise
  // founding several orders in a decade, which cheapens every one of them.
  const bySubject = new Map<EntityId, { total: number; variants: LivingLegend[] }>();
  for (const lg of livingLegendsAt(world, seatId)) {
    if (world.organizations.some((o) => o.category === ORG_CATEGORY_DEVOTIONAL && o.legendSubjectId === lg.subject)) continue;
    let rec = bySubject.get(lg.subject);
    if (!rec) bySubject.set(lg.subject, (rec = { total: 0, variants: [] }));
    rec.total += lg.holders.length;
    rec.variants.push(lg);
  }
  const eligible = [...bySubject.entries()]
    .filter(([, rec]) => rec.total >= threshold)
    .sort((a, b) => b[1].total - a[1].total || a[0] - b[0]);
  {
    const top = eligible[0];
    if (!top) return;
    const lg = top[1].variants.sort((a, b) => b.holders.length - a.holders.length || a.assertion.localeCompare(b.assertion))[0];

    // the founder: the believer whose name carries furthest (deterministic tiebreak by id)
    const founder = [...lg.holders].sort((a, b) => standingOf(world, b) - standingOf(world, a) || a - b)[0];
    const subjectName = world.names.get(lg.subject) ?? `#${lg.subject}`;
    const name = orderNameFor(lg.variant, subjectName);
    const id = createOrganization(world, {
      name,
      category: ORG_CATEGORY_DEVOTIONAL,
      subtype: 'order',
      governanceId: s.governmentId, // an order mirrors the custom of the people who raised it
      foundedYear: year,
      leaderId: founder,
      seatId: s.id,
    });
    getOrganization(world, id)!.legendSubjectId = lg.subject;
    enroll(world, id, founder, ROLE_FOUNDER);
    enroll(world, id, founder, ROLE_LEADER);

    // trace the founding back through the founder's own evidence to the original event
    const founderBelief = (world.beliefs.get(founder) ?? []).find((b) => b.subject === lg.subject && b.assertion === lg.assertion);
    const causeEv = founderBelief?.evidence[0]?.cause;
    const tale = driftSpecsFor(baseAssertion(lg.assertion)).find((d) => d.id === lg.variant)?.label ?? 'became a legend';
    emit(
      world,
      'order_founded',
      [founder],
      { order: name, settlement: s.name, subject: subjectName, tale, believers: top[1].total },
      causeEv !== undefined ? [causeEv] : [],
      [s.id],
    );
  }
}
