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
import { createOrganization, enroll, getOrganization, ROLE_FOUNDER, ROLE_LEADER } from './organization';
import {
  LEGEND_THEMES,
  LEGEND_MIN_HOLDERS,
  LEGEND_SATURATION,
  LEGEND_ORDER_HOLDERS,
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
 * CONSUMER 3 — organization founding. A legend held broadly enough founds a DEVOTIONAL
 * order: seated at the settlement, led by its highest-standing believer, named by the
 * pack from the legend's variant ("the Seekers of Wryo"), and remembering the legend
 * that founded it. The founding event's causes run through the founder's own evidence
 * back to the original event — "why does this order exist?" resolves completely.
 * Focused-settlement only by construction (only there do believers exist). RNG-free.
 */
export function legendOrdersYearly(world: World): void {
  const seatId = world.focusedSettlementId;
  if (seatId < 0) return;
  const s = world.settlements[seatId];
  if (!s || s.ruinedYear !== undefined) return;
  const year = Math.floor(world.tick / DAYS_PER_YEAR);

  for (const lg of livingLegendsAt(world, seatId)) {
    if (lg.holders.length < LEGEND_ORDER_HOLDERS) continue;
    // one order per legendary subject, ever — a second telling joins the first's story
    if (world.organizations.some((o) => o.category === ORG_CATEGORY_DEVOTIONAL && o.legendSubjectId === lg.subject)) continue;

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
      { order: name, settlement: s.name, subject: subjectName, tale, believers: lg.holders.length },
      causeEv !== undefined ? [causeEv] : [],
      [s.id],
    );
  }
}
