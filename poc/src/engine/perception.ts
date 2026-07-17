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
import { fullActors, getRel, remember, emit, getEvent } from './world';
import { addThought } from './opinion';
import { recordDeed } from './reputation';
import { witnessBelief, coronationSlot } from './belief';
import { learnCoronation } from './statusBelief';
import { escalateAnimosity, personalityOf } from './social';
import { reputeSpec, ethicsWeightFor, preceptFor, patronDeityOf, deityById } from './pack';
import { addSelfThought } from './mood';

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
  // how much this settlement's culture amplifies or tolerates this kind of deed
  const cultureId = world.settlements[world.focusedSettlementId]?.cultureId ?? '';
  const culturalWeight = ethicsWeightFor(cultureId, kind);
  // local stream — salted by actor so two deeds in one event (a mutual brawl) pick
  // independent crowds, and the shared settlement RNG is never advanced.
  const rng = new Rng(mixSeed(world.seed, eventId, actor));

  const witnesses: EntityId[] = [];
  for (const id of fullActors(world)) {
    if (id === actor || id === other) continue;
    if (witnesses.length >= WITNESS_CAP) break;
    if (rng.chance(WITNESS_CHANCE)) witnesses.push(id);
  }

  // a deed the community treats as a cultural profanity (weight ≥ 2.0) triggers
  // moral revulsion — a stronger, distinct witness thought — and a named religious
  // condemnation in the history if the settlement has a patron deity.
  const isTaboo = culturalWeight >= 2.0;

  // the creed's PRECEPT about this deed (design/23): its conscience. A precept lays a
  // SELF-thought (→ mood) on those who see or do the deed — the moral feeling belief
  // gives, distinct from the opinion of the doer. `sacred` precepts are felt only by
  // adherents (faithful to the culture's patron); civic ones by everyone of the culture.
  const precept = preceptFor(cultureId, kind);
  const patron = patronDeityOf(cultureId).id;
  const adheres = (id: EntityId): boolean => !precept?.sacred || world.faith.get(id) === patron;

  const wt = spec.witnessThought;
  for (const w of witnesses) {
    remember(world, w, eventId); // episodic memory of what they saw — always
    // A personal opinion forms only for deeds notable enough to carry a witnessThought
    // (a killing's dread, generosity's admiration). A lesser deed (a scuffle) shifts
    // standing only — it doesn't reshape the social graph or perturb the wider sim.
    if (wt) {
      const edge = getRel(world, w, actor);
      const thoughtKind = isTaboo ? 'tabooHorror' : wt.kind;
      const thoughtValue = Math.round((wt.value ?? -150) * culturalWeight);
      addThought(edge, thoughtKind, world.tick, { value: thoughtValue, cause: eventId });
      // profanities always escalate animosity (moral outrage is never idle)
      if (wt.escalates || isTaboo) escalateAnimosity(world, w, actor, edge);
    }
    // CONSCIENCE (witness): the moral feeling of having SEEN this deed — independent of
    // whether an opinion formed, so a devout onlooker is troubled by a brawl (no dread)
    // just as by a killing. Sacred precepts skip the unfaithful.
    if (precept?.witnessSelf && adheres(w)) addSelfThought(world, w, precept.witnessSelf, { cause: eventId });
  }

  // CONSCIENCE (doer): what committing the deed does to the actor's OWN mood — guilt
  // against the creed, or pride in upholding it. The doer feels it whether or not anyone
  // witnessed (a private sin still weighs), so it is not gated on `witnesses`.
  if (precept?.commitSelf && adheres(actor)) addSelfThought(world, actor, precept.commitSelf, { cause: eventId });

  // standing cost is scaled by the community's ethical stance on this deed type
  recordDeed(world, actor, kind, {
    value: Math.round(spec.base * culturalWeight),
    witnesses: witnesses.length,
    cause: eventId,
  });

  // a culturally-tabooed deed in a settlement that has a patron deity becomes a
  // RELIGIOUS condemnation — a named event in the history, so "condemned by the
  // Rootmother" is traceable and not just an opaque standing number.
  if (isTaboo && cultureId) {
    const deity = patronDeityOf(cultureId);
    const condemnedId = emit(world, 'condemned', [actor], { deity: deity.name, deed: kind }, [eventId]);
    // A faithful actor publicly condemned may lose faith from the shame — 15 % chance.
    // The causal chain is preserved: apostasy → condemnation → deed.
    const actorFaith = world.faith.get(actor);
    if (actorFaith) {
      const apostasyRng = new Rng(mixSeed(world.seed, actor, condemnedId));
      if (apostasyRng.chance(0.15)) {
        world.faith.set(actor, '');
        emit(world, 'apostasy', [actor], { deity: deityById(actorFaith).name }, [condemnedId]);
      }
    }
  }

  return witnesses;
}

/**
 * Someone STANDS AGAINST a public threat (today: a beast that fell on the settlement).
 * The bravest resident on hand steps up — boldness is innate temperament, so who plays
 * the hero is character, not a die roll — and earns lasting VALOUR renown, known
 * town-wide. Returns the hero (or undefined if no one bold enough was there).
 *
 * Deterministic: scans residents in id order, picks the boldest (strict `>` keeps the
 * lowest id on a tie); no RNG. A purely positive, earned counterpart to wrongdoing.
 */
export function standAgainst(world: World, threatEventId: EventId, settlementId: number): EntityId | undefined {
  let hero: EntityId | undefined;
  let bravest = 0; // a hero needs positive nerve — a town of cowards yields none
  let residents = 0;
  for (const id of fullActors(world)) {
    if (world.homeSettlement.get(id) !== settlementId) continue;
    residents++;
    const boldness = personalityOf(world, id).temperament.boldness ?? 0;
    if (boldness > bravest) {
      bravest = boldness;
      hero = id;
    }
  }
  if (hero === undefined) return undefined;
  recordDeed(world, hero, 'valor', { witnesses: residents, cause: threatEventId });
  return hero;
}

/**
 * BELIEF-WORTHY events: witnessing one makes co-residents come to KNOW it — the event type
 * maps to the assertion a witness forms about its subject (subjects[0]). Deliberately TINY:
 * witnessing a harvest, a tax update, or a festival must NOT spawn beliefs, or the evidence
 * graph drowns in trivia before we learn what matters.
 *
 * The bar an event must clear to be added here:
 *   1. a CLEAN (subject, assertion) pair — the proposition is about `subjects[0]` and nothing else;
 *   2. PUBLIC — something bystanders could actually see. A private event must never be witnessed
 *      (religion.ts's crisis of faith is "spontaneous, private" — so `apostasy` is NOT here);
 *   3. WORTH knowing — rare and consequential enough that the evidence graph earns its keep.
 *      This is why `born` is absent despite being an obvious candidate: every peasant birth would
 *      spawn evidence in every witness, and no consumer asks "is X alive". Volume without drama.
 *
 * A proposition added here is automatically subject to Legend Drift (design/30 §4.1) once the pack
 * gives it a `DRIFT_SPECS` table — that is what makes widening this list worth doing: each new row
 * is a new kind of story the world's oral histories can disagree about.
 */
export const BELIEF_WORTHY: Record<string, string> = {
  died: 'dead',
  died_brawl: 'dead',
  // A RULER's death — the archetypal legend, and the running example of every epistemics doc
  // ("the king is dead"). Reuses the `dead` assertion (and so its drift table) exactly: a death
  // is a death, whoever it happened to. Fires world-wide, so it leans on perceiveEvent's
  // locality guard to keep a distant king's death from being "witnessed" at home.
  ruler_died: 'dead',
  // Cast out after a civil war: public, rare, momentous, and — unlike a death — a thing whose
  // REASON folk will happily invent. "Why was she exiled?" is how legends start.
  exile: 'exiled',
  // An heirloom's fate when its holder's city falls (design/33). Both are public (a sack is
  // watched; plunder is paraded), rare (objects are minted scarce), and consequential — and
  // `lost` is the treasure-tale seed: WHERE it went is precisely what the drift table invents.
  object_lost: 'lost',
  object_seized: 'seized',
};

/**
 * Live-loop belief formation. When a belief-worthy event fires in the focused settlement,
 * co-resident witnesses (a per-event seeded draw — not everyone sees everything) come to
 * KNOW it firsthand. Returns the witnesses. A no-op for events not in BELIEF_WORTHY.
 *
 * LOCALITY: `whereId` is the settlement the event HAPPENED IN, and the caller must say so — you
 * cannot witness what did not happen in front of you. Only the focused settlement has actors to
 * witness anything, so an event elsewhere forms no belief here; its people learn later, once news
 * travels (1C-distal). This is required rather than inferred because a witness draw reads
 * `fullActors`, which is scoped by FIDELITY, not by settlement — so without it, a king dying two
 * kingdoms away would be "seen" at home by everyone. Every new BELIEF_WORTHY row must therefore
 * name its place, and the omniscience bug is unavailable by construction rather than by care. It
 * is the same guard `perceiveCoronation` already applies to itself.
 *
 * DETERMINISM: witnesses are drawn from a LOCAL stream keyed by (seed, event, subject), so
 * this never advances the shared settlement RNG — the rest of the sim is byte-identical
 * whether or not anyone was watching (exactly like witnessDeed). INERT: forms beliefs, emits
 * nothing (invariant 8) — though what an actor DOES on learning it (reactions.ts: mourning) is
 * history, and a newly-witnessed death is a newly-mourned one.
 */
export function perceiveEvent(world: World, eventId: EventId, whereId: number): EntityId[] {
  if (whereId !== world.focusedSettlementId) return []; // it did not happen where the subjects are
  const ev = getEvent(world, eventId);
  if (!ev) return [];
  const assertion = BELIEF_WORTHY[ev.type];
  if (assertion === undefined) return []; // most events are not belief-worthy
  const subject = ev.subjects[0];
  if (subject === undefined) return [];

  const rng = new Rng(mixSeed(world.seed, eventId, subject));
  const witnesses: EntityId[] = [];
  for (const id of fullActors(world)) {
    if (id === subject) continue; // the subject does not witness their own death
    if (witnesses.length >= WITNESS_CAP) break;
    if (rng.chance(WITNESS_CHANCE)) witnesses.push(id);
  }
  for (const w of witnesses) witnessBelief(world, w, subject, assertion, eventId);
  return witnesses;
}

/**
 * Live coronation producer (coronation → allegiance, rung 2). When a settlement seats a new ruler
 * (an `ascension` / `dynasty` event), its resident actors come to believe that ruler reigns — so
 * the polity, via `orgStatusBeliefOf`, comes to recognize them. A coronation is public LOCAL news,
 * so EVERY resident learns it (broad awareness is what lets the institution recognize the ruler).
 *
 * Only fires where residents are simulated — the focused settlement. Remote settlements learn later,
 * once news travels (1C-distal). Inert (invariant 8) — forms beliefs, emits nothing. No RNG, so the
 * yearly succession pass stays byte-identical whether or not anyone is home to hear it.
 */
export function perceiveCoronation(world: World, settlementId: number, rulerId: EntityId, eventId: EventId): void {
  if (settlementId !== world.focusedSettlementId) return; // only where subjects exist to hold a belief
  const slot = coronationSlot(settlementId);
  for (const id of fullActors(world)) {
    if (world.homeSettlement.get(id) === settlementId) learnCoronation(world, id, rulerId, slot, eventId);
  }
}
