/**
 * PERCEPTION — who SAW it. The substrate beneath emergent reputation and feuds
 * (design 04 §3.7: "build perception/memory/reputation well and most interesting
 * stories arise without scripting"). It handles any public DEED in the focused
 * settlement — a killing, a scuffle, an act of generosity.
 *
 * When a deed happens, co-resident bystanders WITNESS it (a per-deed seeded draw, so
 * not everyone sees everything — "observed only by actors in range"), commit it to
 * episodic MEMORY, and (for deeds grave or generous enough) form an opinion of the
 * actor. The actor's public STANDING (reputation.ts) shifts by a sourced amount
 * scaled by how many saw it. A grave deed's dread, when it tips a witness past
 * rivalry/feud, escalates through the SAME shared rule the social loop uses
 * (escalateAnimosity) — so a public killing can MAKE enemies of strangers, and the
 * resulting feud traces back to its cause. Emergence + legibility.
 *
 * DETERMINISM: witnesses are drawn from a LOCAL stream keyed by (seed, event, actor),
 * so perception never touches the shared settlement RNG — the rest of the NPC
 * simulation is byte-identical whether or not anyone happened to be watching.
 */
import { type World, type EntityId, type EventId } from './model';
import { Rng, mixSeed } from './rng';
import { fullActors, getRel, remember } from './world';
import { addThought } from './opinion';
import { addMark, emptyReputation } from './reputation';
import { escalateAnimosity } from './social';
import { reputeSpec } from '../content/fixture';

/** A co-resident's chance of having been present to see a public deed. */
const WITNESS_CHANCE = 0.5;
/** Cap on bystanders per deed — bounds the work and keeps a single act from being
 *  seen by the entire village at once. */
const WITNESS_CAP = 8;

/**
 * Record that `actor` committed a public deed (`eventId`, of repute `kind`) involving
 * `other` (the victim of a wrongdoing, or the recipient of a kindness — excluded from
 * the witnesses). Returns the witnesses, for testing/inspection.
 *
 * `kind` is a pack reputation id (REPUTE_SPECS): 'bloodshed' / 'violence' /
 * 'generosity'. The spec decides the standing delta AND whether each witness forms a
 * personal opinion of the actor (its `witnessThought`) — so a killing sows dread that
 * can curdle into a feud, a scuffle costs standing only, and generosity earns
 * admiration. A deed with no witnessThought never reshapes the social graph.
 */
export function witnessDeed(
  world: World,
  eventId: EventId,
  actor: EntityId,
  other: EntityId,
  kind: string,
): EntityId[] {
  const spec = reputeSpec(kind);
  // local stream — salted by actor so two deeds in one event (a mutual brawl) pick
  // independent crowds, and the shared settlement RNG is never advanced.
  const rng = new Rng(mixSeed(world.seed, eventId, actor));

  const witnesses: EntityId[] = [];
  for (const id of fullActors(world)) {
    if (id === actor || id === other) continue;
    if (witnesses.length >= WITNESS_CAP) break;
    if (rng.chance(WITNESS_CHANCE)) witnesses.push(id);
  }

  const wt = spec.witnessThought;
  for (const w of witnesses) {
    remember(world, w, eventId); // episodic memory of what they saw — always
    // A personal opinion forms only for deeds notable enough to carry a witnessThought
    // (a killing's dread, generosity's admiration). A lesser deed (a scuffle) shifts
    // standing only — it doesn't reshape the social graph or perturb the wider sim.
    if (wt) {
      const edge = getRel(world, w, actor);
      addThought(edge, wt.kind, world.tick, { value: wt.value, cause: eventId });
      // grave deeds can curdle into open enmity — via the SAME rule courtship uses
      if (wt.escalates) escalateAnimosity(world, w, actor, edge);
    }
  }

  // the actor's public standing shifts, scaled by how many saw it
  let rep = world.reputation.get(actor);
  if (!rep) {
    rep = emptyReputation();
    world.reputation.set(actor, rep);
  }
  addMark(rep, kind, world.tick, { witnesses: witnesses.length, cause: eventId });

  return witnesses;
}
