/**
 * Historical figures. Named people the world remembers — founders and a line of
 * rulers per settlement — minted by the AGGREGATE layer (so the headless worldgen
 * has people, not just faceless events). Figures are lightweight records: they get
 * an id and a name in the registry (so events can name them) but no ECS components,
 * so the actor systems never touch them. The DF "historical figures are records,
 * not agents" model. Deterministic via a dedicated RNG stream.
 */
import { type World, type Settlement, type HistoricalFigure, type FigureId, DAYS_PER_YEAR } from './model';
import { Rng } from './rng';
import { emit } from './world';
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
      const successor = mintFigure(world, s, year, rng, 'ruler');
      s.currentRulerId = successor.id;
      emit(world, 'ascension', [successor.id], { settlement: s.name });
    }
  }

  world.figureRngState = rng.state;
}
