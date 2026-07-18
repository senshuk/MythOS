/**
 * BINDINGS (design/36, implementing design/30 §4.3) — oaths, curses, vows: the mythic
 * layer's one genuinely new Construct. A Binding constrains FUTURE reasoning across time
 * and generations — no existing Mark reduces to that shape, which is exactly why it was
 * prototyped smallest and frozen fastest (Prime Movers' growth law).
 *
 * LAWS:
 *  - A Binding never fires an action. It only WEIGHTS or FORBIDS candidate Intents at
 *    the Reasoning stage (systems/decide.ts consults it), exactly as a Belief biases —
 *    Belief → Reasoning, never Belief → Reality.
 *  - WHAT a kind of binding forbids or urges is PACK data (BINDING_CONSTRAINTS): no
 *    oath is hardcoded; a sci-fi pack's AI directive rides the same Construct.
 *  - Inheritance piggybacks on the birth rule the world already has: a child of a
 *    carrier of an inheritable binding is enrolled at birth. One sworn moment, centuries
 *    of consequence — and "why did she refuse?" resolves through carriers + cause.
 *  - RNG-FREE throughout: which bindings exist, who inherits, and what resolves follows
 *    only from events. A world with no oaths is byte-identical in every stream.
 */
import { type World, type EntityId, type EventId, type Binding } from './model';
import { type Intent } from './intent';
import { emit, isAlive } from './world';
import { BINDING_CONSTRAINTS } from './pack';

/** Swear a new binding. `cause` is the event that occasioned it (a kin slain, a pact). */
export function swearBinding(
  world: World,
  p: { kind: string; swearer: EntityId; subject: EntityId; inheritable: boolean; cause?: EventId },
): Binding {
  const b: Binding = {
    id: world.nextEntityId++,
    kind: p.kind,
    subject: p.subject,
    carriers: [p.swearer],
    inheritable: p.inheritable,
    sinceTick: world.tick,
    cause: p.cause,
  };
  world.bindings.push(b);
  emit(
    world,
    'oath_sworn',
    [p.swearer],
    { kind: p.kind, who: world.names.get(p.subject) ?? String(p.subject) },
    p.cause !== undefined ? [p.cause] : [],
  );
  return b;
}

/** The LIVE bindings this actor carries (resolved ones are history, not constraint). */
export function bindingsOn(world: World, actorId: EntityId): Binding[] {
  return world.bindings.filter((b) => b.resolvedTick === undefined && b.carriers.includes(actorId));
}

/**
 * REASONING GATE (the forbid half): would this intent violate a binding the actor
 * carries? Consulted by the decider on the intent it is about to produce; a forbidden
 * intent is simply not chosen (the constraint bounds the will, it never moves the hand).
 * Returns the violated binding for legibility, or undefined.
 */
export function bindingForbids(world: World, actorId: EntityId, intent: Intent): Binding | undefined {
  for (const b of bindingsOn(world, actorId)) {
    const rule = BINDING_CONSTRAINTS[b.kind];
    if (rule && rule(intent, b) === 'forbid') return b;
  }
  return undefined;
}

/**
 * REASONING GATE (the weight half): the pursuit a binding urges on this actor, if its
 * subject is a living neighbour — a sworn avenger seeks their quarry. The decider may
 * act on it or not (its own policy and dice); the binding only surfaces the pull.
 */
export function bindingUrge(world: World, actorId: EntityId): { intent: Intent; binding: Binding } | undefined {
  const home = world.homeSettlement.get(actorId);
  for (const b of bindingsOn(world, actorId)) {
    const rule = BINDING_CONSTRAINTS[b.kind];
    if (!rule) continue;
    if (!isAlive(world, b.subject) || world.homeSettlement.get(b.subject) !== home) continue;
    const probe: Intent = { kind: 'provoke', target: b.subject };
    if (rule(probe, b) === 'urge') return { intent: probe, binding: b };
  }
  return undefined;
}

/** At a birth: a child of any carrier of an inheritable, unresolved binding is enrolled —
 *  the bloodline oath passing down, mirroring how traits and heirlooms already inherit. */
export function inheritBindings(world: World, child: EntityId, parents: EntityId[]): void {
  for (const b of world.bindings) {
    if (!b.inheritable || b.resolvedTick !== undefined) continue;
    if (parents.some((p) => b.carriers.includes(p)) && !b.carriers.includes(child)) {
      b.carriers.push(child);
    }
  }
}

/**
 * Yearly: resolve bindings whose subject has left the world — a vengeance sworn against
 * the now-dead is FULFILLED (someone or something concluded the tale); the constraint
 * lifts, the record stays. Emits once, subjects = the living carriers who are released.
 */
export function bindingsYearly(world: World): void {
  for (const b of world.bindings) {
    if (b.resolvedTick !== undefined) continue;
    if (world.lifecycle.has(b.subject) && isAlive(world, b.subject)) continue;
    if (!world.lifecycle.has(b.subject)) continue; // a non-actor subject (place, org) does not die
    b.resolvedTick = world.tick;
    const living = b.carriers.filter((c) => isAlive(world, c)).slice(0, 3);
    emit(
      world,
      'oath_fulfilled',
      living,
      { kind: b.kind, who: world.names.get(b.subject) ?? String(b.subject) },
      b.cause !== undefined ? [b.cause] : [],
    );
  }
}
