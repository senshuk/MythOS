/**
 * PERCEPTION — who SAW it. The substrate beneath emergent reputation and feuds
 * (design 04 §3.7: "build perception/memory/reputation well and most interesting
 * stories arise without scripting"). Today it handles the canonical case: a public
 * WRONGDOING in the focused settlement.
 *
 * When someone sheds blood, co-resident bystanders WITNESS it (a per-deed seeded
 * draw, so not everyone sees everything — "observed only by actors in range"),
 * commit it to episodic MEMORY, and form a fearful opinion of the culprit. The
 * culprit's public STANDING (reputation.ts) takes a sourced hit scaled by how many
 * saw it. When the accrued dread tips a witness past rivalry/feud, the bond
 * escalates through the SAME shared rule the social loop uses (escalateAnimosity) —
 * so a public killing can MAKE enemies of strangers, and the resulting feud traces
 * back through the brawl to its cause. That is the whole point: emergence + legibility.
 *
 * DETERMINISM: witnesses are drawn from a LOCAL stream keyed by (seed, event,
 * culprit), so perception never touches the shared settlement RNG — the rest of the
 * NPC simulation is byte-identical whether or not anyone happened to be watching.
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
 * Record that `culprit` committed a public wrongdoing (`eventId`, of repute `kind`)
 * against `victim`. Returns the witnesses, for testing/inspection.
 *
 * `kind` is a pack reputation id (REPUTE_SPECS): 'bloodshed' for a killing,
 * 'violence' for a non-lethal brawl. The dread a witness feels is the spec's
 * `fearValue`, so a killing curdles enmity far faster than a scuffle.
 */
export function witnessWrongdoing(
  world: World,
  eventId: EventId,
  culprit: EntityId,
  victim: EntityId,
  kind: string,
): EntityId[] {
  const spec = reputeSpec(kind);
  // local stream — salted by culprit so two deeds in one event (a mutual brawl)
  // pick independent crowds, and the shared settlement RNG is never advanced.
  const rng = new Rng(mixSeed(world.seed, eventId, culprit));

  const witnesses: EntityId[] = [];
  for (const id of fullActors(world)) {
    if (id === culprit || id === victim) continue;
    if (witnesses.length >= WITNESS_CAP) break;
    if (rng.chance(WITNESS_CHANCE)) witnesses.push(id);
  }

  for (const w of witnesses) {
    remember(world, w, eventId); // episodic memory of what they saw — always
    // PERSONAL dread is reserved for grave deeds (spec.fearValue ≠ 0, i.e. a
    // killing). A lesser deed marks the culprit's standing but doesn't reshape the
    // social graph — so a commonplace scuffle costs reputation without making a
    // lasting enemy of every onlooker (and doesn't perturb the wider simulation).
    if (spec.fearValue !== 0) {
      const edge = getRel(world, w, culprit);
      addThought(edge, 'feared', world.tick, { value: spec.fearValue, cause: eventId });
      // dread can curdle into open enmity — via the SAME threshold rule courtship uses
      escalateAnimosity(world, w, culprit, edge);
    }
  }

  // the culprit's public standing takes a hit, scaled by how many saw it
  let rep = world.reputation.get(culprit);
  if (!rep) {
    rep = emptyReputation();
    world.reputation.set(culprit, rep);
  }
  addMark(rep, kind, world.tick, { witnesses: witnesses.length, cause: eventId });

  return witnesses;
}
