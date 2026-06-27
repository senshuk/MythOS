/**
 * Historical figures. Named people the world remembers — founders and a line of
 * rulers per settlement — minted by the AGGREGATE layer (so the headless worldgen
 * has people, not just faceless events). Figures are lightweight records: they get
 * an id and a name in the registry (so events can name them) but no ECS components,
 * so the actor systems never touch them. The DF "historical figures are records,
 * not agents" model. Deterministic via a dedicated RNG stream.
 */
import {
  type World,
  type Settlement,
  type HistoricalFigure,
  type FigureId,
  type EntityId,
  ADULT_AGE,
  DAYS_PER_YEAR,
} from './model';
import { Rng } from './rng';
import { emit, fullActors, relCount } from './world';
import { generateGiven, generateFamily } from '../content/fixture';

/** Create a figure: a name in the registry + a record. Caller supplies the RNG so
 *  founders (worldgen stream) and successions (figure stream) stay deterministic. */
export function mintFigure(
  world: World,
  s: Settlement,
  year: number,
  rng: Rng,
  role: 'founder' | 'ruler',
): HistoricalFigure {
  const id: FigureId = world.nextEntityId++;
  const species = s.macro.dominantSpecies;
  const name = `${generateGiven(rng, species)} ${generateFamily(rng)}`;
  world.names.set(id, name); // so events that reference this figure render its name
  const fig: HistoricalFigure = {
    id,
    name,
    species,
    role,
    settlementId: s.id,
    bornYear: year - rng.range(22, 42),
    reignStart: year,
    reignEnd: year + rng.range(15, 45),
  };
  world.figures.push(fig);
  return fig;
}

export function getFigure(world: World, id: FigureId | undefined): HistoricalFigure | undefined {
  if (id === undefined) return undefined;
  for (const f of world.figures) if (f.id === id) return f;
  return undefined;
}

/** The local heir to a focused settlement's rule: the most prominent living adult,
 *  the ambitious (proud) favoured. Deterministic — no RNG (fullActors is id-order,
 *  strict `>` keeps the lowest-id winner on ties). */
function chooseHeir(world: World, settlementId: number): EntityId | undefined {
  let best: EntityId | undefined;
  let bestProud = -1;
  let bestTies = -1;
  for (const id of fullActors(world)) {
    if (world.homeSettlement.get(id) !== settlementId) continue;
    if (world.lifecycle.get(id)!.ageYears < ADULT_AGE) continue;
    const proud = world.traits.get(id)!.includes('proud') ? 1 : 0;
    const ties = relCount(world, id);
    if (proud > bestProud || (proud === bestProud && ties > bestTies)) {
      bestProud = proud;
      bestTies = ties;
      best = id;
    }
  }
  return best;
}

/** Crown a simulated actor: mint a figure record sharing the actor's id (FigureId
 *  shares the entity id space), so the actor is *also* a remembered ruler. The
 *  record outlives demotion, so an actor who rose to power persists in history. */
function crownActor(world: World, s: Settlement, id: EntityId, year: number, rng: Rng): FigureId {
  const idn = world.identity.get(id)!;
  const lc = world.lifecycle.get(id)!;
  world.figures.push({
    id,
    name: world.names.get(id) ?? `${idn.given} ${idn.family}`,
    species: idn.speciesId,
    role: 'ruler',
    settlementId: s.id,
    bornYear: year - lc.ageYears,
    reignStart: year,
    reignEnd: year + rng.range(15, 45),
  });
  return id;
}

/** Yearly: rule passes from one figure to the next when a reign ends. Living
 *  settlements always have a ruler (the founder, then successors). */
export function figuresYearly(world: World): void {
  const rng = new Rng(world.figureRngState);
  const year = Math.floor(world.tick / DAYS_PER_YEAR);

  for (const s of world.settlements) {
    if (s.ruinedYear !== undefined || s.macro.population <= 0) continue; // no rule in a dying town

    const ruler = getFigure(world, s.currentRulerId);
    if (!ruler) {
      // defensive: a living settlement with no ruler gets one
      s.currentRulerId = mintFigure(world, s, year, rng, 'ruler').id;
      continue;
    }
    if (year >= ruler.reignEnd) {
      ruler.deathYear = year;
      emit(world, 'ruler_died', [ruler.id], { settlement: s.name });
      // In the focused settlement, rule passes to a real local heir (so an actor —
      // and the player — can actually rise to lead). Elsewhere, mint a figure.
      let successorId: FigureId;
      if (s.detailed && s.id === world.focusedSettlementId) {
        const heir = chooseHeir(world, s.id);
        successorId = heir !== undefined ? crownActor(world, s, heir, year, rng) : mintFigure(world, s, year, rng, 'ruler').id;
      } else {
        successorId = mintFigure(world, s, year, rng, 'ruler').id;
      }
      s.currentRulerId = successorId;
      emit(world, 'ascension', [successorId], { settlement: s.name });
    }
  }

  world.figureRngState = rng.state;
}
