/**
 * GATHERINGS — communal events that assemble named villagers (design/27 §4). A wedding
 * draws the couple's kin and friends; a funeral draws the mourners. One generic
 * mechanism: pick a venue, record the gathering as an event, and leave a mood
 * self-thought on every attendee (joy at a feast, the shared grief of a pyre). The
 * kinds, venues and thought labels are the pack's vocabulary — the engine holds only
 * the mechanism.
 *
 * THE LAW (design/25 §2, design/27 §2): assembling a gathering draws NO world.rng — who
 * attends is a pure function of the existing relationship graph, venue choice a hash. So
 * adding gatherings re-rolls no existing history. (The mood thoughts they leave DO shape
 * the future — a village that mourns its dead is a real deepening, not an annotation.)
 */
import { type World, type EntityId, type EventId } from './model';
import { emit, isAlive } from './world';
import { pickVenue } from './venues';
import { addSelfThought } from './mood';
import { computeOpinion } from './opinion';
import { mixSeed } from './rng';

export type GatheringKind = 'wedding' | 'funeral' | 'feast' | 'rite';

/** the self-thought each kind leaves on those who came (pack vocabulary). */
const MOOD_OF: Record<GatheringKind, string> = {
  wedding: 'feasted',
  feast: 'feasted',
  rite: 'feasted',
  funeral: 'mourned',
};

/** every gathering kind, as event types — the one place the roster is enumerated, so a
 *  consumer (the close view's crowd) can recognize one without re-listing the kinds. */
export const GATHERING_KINDS: ReadonlySet<string> = new Set(Object.keys(MOOD_OF));

/**
 * The people who would come: the principals' living kin (spouse / parents / children)
 * and their strongest friends, deduped, capped, ordered kin-first with a hash tie-break.
 * Deterministic and rng-free. Reads ties from world.ties/world.rels, so for a funeral
 * call this BEFORE killActor prunes the deceased's edges.
 */
export function communityAround(world: World, focal: EntityId[], cap = 8): EntityId[] {
  const focalSet = new Set(focal);
  const score = new Map<EntityId, number>();
  const consider = (id: EntityId, s: number) => {
    if (focalSet.has(id) || !isAlive(world, id)) return;
    const prev = score.get(id);
    if (prev === undefined || s > prev) score.set(id, s);
  };
  for (const f of focal) {
    const ties = world.ties.get(f);
    if (ties) {
      for (const sp of ties.spouses) consider(sp, 1000);
      for (const p of ties.parents) consider(p, 900);
      for (const c of ties.children) consider(c, 900);
    }
    const rels = world.rels.get(f);
    if (rels) {
      for (const [other, edge] of rels) {
        // friends (and any spouse edge) come; strength orders the guest list
        if (edge.flags.friend || edge.flags.spouse) consider(other, 500 + Math.max(0, computeOpinion(edge, world.tick)));
      }
    }
  }
  return [...score.entries()]
    .sort((x, y) => y[1] - x[1] || mixSeed(world.seed, x[0]) - mixSeed(world.seed, y[0]))
    .slice(0, cap)
    .map(([id]) => id);
}

/**
 * Hold a gathering: locate it, record it as a communal event (subjects = the principals,
 * for naming), and leave a mood self-thought on every attendee who came. Returns the
 * event id, or -1 if no one gathered (a hermit's passing draws no crowd). Draws no rng.
 */
export function holdGathering(
  world: World,
  kind: GatheringKind,
  focal: EntityId[],
  attendees: EntityId[],
  cause?: EventId,
): EventId {
  const living = attendees.filter((id) => isAlive(world, id));
  if (living.length === 0) return -1; // no crowd — not a public gathering
  const a = focal[0];
  const b = focal[1] ?? focal[0];
  const where = pickVenue(world, kind, a, b);
  const home = world.homeSettlement.get(a);
  const data: Record<string, number | string> = { count: living.length };
  if (where) { data.venue = where.venue; data.venueId = where.venueId; }
  if (home !== undefined && world.settlements[home]) data.settlement = world.settlements[home].name;
  const id = emit(world, kind, focal, data, cause !== undefined ? [cause] : [], home !== undefined ? [home] : []);
  const mood = MOOD_OF[kind];
  for (const att of living) addSelfThought(world, att, mood, { cause: id });
  return id;
}
