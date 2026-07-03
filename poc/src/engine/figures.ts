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
  type FigureRole,
  type House,
  type HouseId,
  type EntityId,
  DAYS_PER_YEAR,
} from './model';
import { Rng } from './rng';
import { emit, fullActors, relCount } from './world';
import { standingOf, recordDeed } from './reputation';
import { perceiveCoronation } from './perception';
import { generateGiven, generateFamily, maturityOf, ambitionOf, governmentById, leaderTitleOf, reignSpan, HEIR_WEIGHTS } from '../content/fixture';
import { tongueFor } from '../content/languages';
import { startCivilWarClock } from './factions';
import { appointLeader, dissolve } from './organization';

// ------------------------------------------------------------- houses --------
// Prestige weights — how much standing a House's deeds earn it. Engine constants for
// now (a pack could tune them later, like the director's pacing); the DEEDS themselves
// are universe-neutral (found, rule, conquer).
const HOUSE_FOUND = 22; // raise a settlement AND a line
const HOUSE_ASCEND = 6; // each new ruler who continues the line
const HOUSE_REIGN = 4; // a completed reign (+1 per year held, below)
const HOUSE_CONQUEST = 26; // overrun a rival settlement
const DYNASTY_TURNOVER = 0.17; // chance a succession brings a NEW dynasty, not continuity

export function houseById(world: World, id: HouseId | undefined): House | undefined {
  if (id === undefined) return undefined;
  for (const h of world.houses) if (h.id === id) return h;
  return undefined;
}

const surnameOf = (name: string): string => name.split(' ').slice(1).join(' ') || name;

/** Found a House for a figure who has raised a settlement (or seized its seat). The
 *  founder's surname becomes the house name, carried by its line down the generations. */
export function foundHouse(world: World, founder: HistoricalFigure, settlementId: number, year: number): House {
  const house: House = {
    id: world.nextEntityId++,
    name: surnameOf(founder.name),
    founderId: founder.id,
    foundedYear: year,
    originSettlementId: settlementId,
    prestige: HOUSE_FOUND,
    seatSettlementId: settlementId,
  };
  world.houses.push(house);
  founder.houseId = house.id;
  return house;
}

/** Credit a victorious settlement's ruling House for overrunning a rival. */
export function houseConquers(world: World, victor: Settlement): void {
  const ruler = getFigure(world, victor.currentRulerId);
  const house = houseById(world, ruler?.houseId);
  if (house) house.prestige += HOUSE_CONQUEST;
}

/** A settlement's ruling House falls with the city: it loses its seat and its line ends.
 *  Called when a settlement is razed (pre-history or live conquest). */
export function endHouseAt(world: World, settlement: Settlement, year: number): void {
  const ruler = getFigure(world, settlement.currentRulerId);
  const house = houseById(world, ruler?.houseId);
  if (!house || house.extinctYear !== undefined) return;
  house.seatSettlementId = undefined;
  house.extinctYear = year;
  emit(world, 'house_fallen', [], { house: house.name, settlement: settlement.name }, [], [settlement.id]);
  // the polity seated here falls with the city — dissolved, but its history endures.
  dissolve(world, settlement.polityId, year);
}

/** Create a figure: a name in the registry + a record. Caller supplies the RNG so
 *  founders (worldgen stream) and successions (figure stream) stay deterministic. */
export function mintFigure(
  world: World,
  s: Settlement,
  year: number,
  rng: Rng,
  role: FigureRole,
  family?: string, // when given (a dynastic heir), the figure keeps the house surname
): HistoricalFigure {
  const id: FigureId = world.nextEntityId++;
  const species = s.macro.dominantSpecies;
  // draw the given name first (preserve the rng order); take the house surname if one
  // was supplied, else coin a new family — so founders/new dynasties stay byte-identical.
  const given = generateGiven(rng, species);
  const name = `${given} ${family ?? generateFamily(rng, tongueFor(s.cultureId, world.seed))}`;
  world.names.set(id, name); // so events that reference this figure render its name
  const fig: HistoricalFigure = {
    id,
    name,
    species,
    role,
    settlementId: s.id,
    bornYear: year - rng.range(22, 42),
    reignStart: year,
    // a hereditary ruler reigns until death; an elected one serves a fixed term.
    reignEnd: year + reignSpan(s.governmentId, rng),
  };
  addFigure(world, fig);
  return fig;
}

function addFigure(world: World, fig: HistoricalFigure): void {
  world.figures.push(fig);
  world.figuresById.set(fig.id, fig);
  const list = world.figuresBySettlement.get(fig.settlementId);
  if (list) list.push(fig.id);
  else world.figuresBySettlement.set(fig.settlementId, [fig.id]);
}

export function getFigure(world: World, id: FigureId | undefined): HistoricalFigure | undefined {
  if (id === undefined) return undefined;
  return world.figuresById.get(id);
}

/** The local heir to a focused settlement's rule: the most PROMINENT living adult —
 *  weighing ambition (do they want it), RENOWN (public standing), and ties (their
 *  place in the community). Ambition still dominates, but a celebrated soul can now be
 *  raised to lead — the renown→opportunity loop (HEIR_WEIGHTS, pack data). With nobody
 *  renowned this reduces to the old ambition-first, ties-tiebreak order. Deterministic —
 *  no RNG (fullActors is id-order; strict `>` keeps the lowest-id winner on ties). */
export function chooseHeir(world: World, settlementId: number): EntityId | undefined {
  let best: EntityId | undefined;
  let bestProminence = -Infinity;
  let bestTies = -1;
  for (const id of fullActors(world)) {
    if (world.homeSettlement.get(id) !== settlementId) continue;
    if (world.lifecycle.get(id)!.ageYears < maturityOf(world.identity.get(id)!.speciesId)) continue;
    // prominence = ambition + renown (these compete); ties only break a tie. With no
    // renown this is exactly the old ambition-first, ties-tiebreak order.
    const prominence = ambitionOf(world.traits.get(id)!) * HEIR_WEIGHTS.ambition + standingOf(world, id) * HEIR_WEIGHTS.renown;
    const ties = relCount(world, id);
    if (prominence > bestProminence || (prominence === bestProminence && ties > bestTies)) {
      bestProminence = prominence;
      bestTies = ties;
      best = id;
    }
  }
  return best;
}

/** Crown a simulated actor: mint a figure record sharing the actor's id (FigureId
 *  shares the entity id space), so the actor is *also* a remembered ruler. The
 *  record outlives demotion, so an actor who rose to power persists in history. */
function crownActor(world: World, s: Settlement, id: EntityId, year: number, rng: Rng): HistoricalFigure {
  const idn = world.identity.get(id)!;
  const lc = world.lifecycle.get(id)!;
  const fig: HistoricalFigure = {
    id,
    name: world.names.get(id) ?? `${idn.given} ${idn.family}`,
    species: idn.speciesId,
    role: 'ruler',
    settlementId: s.id,
    bornYear: year - lc.ageYears,
    reignStart: year,
    reignEnd: year + reignSpan(s.governmentId, rng),
  };
  addFigure(world, fig);
  return fig;
}

/** Seat a fresh ruler, wiring their HOUSE: if the heir belongs to (shares the surname of)
 *  the seat's house, the DYNASTY CONTINUES; otherwise the heir's line SEIZES the seat — a
 *  new dynasty rises and the old house falls from power (lingering in history). */
function installRuler(
  world: World,
  s: Settlement,
  heir: HistoricalFigure,
  oldHouse: House | undefined,
  year: number,
  title: string,
): void {
  let evId: number;
  if (oldHouse && oldHouse.extinctYear === undefined && surnameOf(heir.name) === oldHouse.name) {
    heir.houseId = oldHouse.id;
    oldHouse.prestige += HOUSE_ASCEND;
    oldHouse.seatSettlementId = s.id;
    s.currentRulerId = heir.id;
    evId = emit(world, 'ascension', [heir.id], { settlement: s.name, title, house: oldHouse.name }, [], [s.id]);
  } else {
    const newHouse = foundHouse(world, heir, s.id, year);
    if (oldHouse && oldHouse.seatSettlementId === s.id) oldHouse.seatSettlementId = undefined; // out of power
    s.currentRulerId = heir.id;
    evId = emit(world, 'dynasty', [heir.id], { settlement: s.name, title, house: newHouse.name, old: oldHouse?.name ?? '' }, [], [s.id]);
  }
  // succession operates on the ORGANIZATION: the polity this settlement hosts gets the new
  // leader (currentRulerId above is now a compatibility mirror of the org's leaderId).
  // appointLeader closes the previous leader's roster record and opens the heir's — the org
  // remembers its line of leaders.
  appointLeader(world, s.polityId, heir.id);

  // residents of a FOCUSED settlement come to believe their new ruler reigns → the polity
  // recognizes them (orgStatusBeliefOf). A no-op for aggregate settlements, which have no
  // simulated residents to hear it (they learn later, once news travels — 1C-distal).
  perceiveCoronation(world, s.id, heir.id, evId);

  // a heir who is a real SIMULATED actor (rose from the focused settlement, not a minted
  // record) earns ASCENSION renown — a public elevation the whole town knows. This feeds
  // the renown→opportunity loop: standing helped raise them, and rule now lifts it further.
  if (world.identity.has(heir.id)) {
    let residents = 0;
    for (const id of fullActors(world)) if (world.homeSettlement.get(id) === s.id) residents++;
    recordDeed(world, heir.id, 'ascension', { witnesses: residents, cause: evId });
  }
}

/** Yearly: leadership transfers per the polity's GOVERNMENT (succession is data).
 *  Hereditary: a ruler reigns until death, then an heir/successor rises — continuing the
 *  ruling HOUSE, or founding a new dynasty. Elected: a leader serves a term, then steps
 *  down (alive). Leaderless polities have no ruler and are skipped entirely. */
export function figuresYearly(world: World): void {
  const rng = new Rng(world.figureRngState);
  const year = Math.floor(world.tick / DAYS_PER_YEAR);

  for (const s of world.settlements) {
    if (s.ruinedYear !== undefined || s.macro.population <= 0) continue; // no rule in a dying town
    const gov = governmentById(s.governmentId);
    if (gov.succession === 'none') continue; // leaderless — no rulers, ever

    const title = leaderTitleOf(s.governmentId);
    const ruler = getFigure(world, s.currentRulerId);
    if (!ruler) {
      // defensive: a leader-bearing polity with no ruler gets one (founding a fresh line)
      const f = mintFigure(world, s, year, rng, 'ruler');
      foundHouse(world, f, s.id, year);
      s.currentRulerId = f.id;
      appointLeader(world, s.polityId, f.id);
      continue;
    }
    if (year >= ruler.reignEnd) {
      const oldHouse = houseById(world, ruler.houseId);
      // a hereditary ruler dies in office; an elected leader merely steps down (lives on).
      if (gov.succession === 'hereditary') {
        ruler.deathYear = year;
        if (oldHouse) oldHouse.prestige += HOUSE_REIGN + (year - ruler.reignStart); // a completed reign
        emit(world, 'ruler_died', [ruler.id], { settlement: s.name, title }, [], [s.id]);
      }
      // In the focused settlement, rule may pass to a real local heir (so an actor — and the
      // player — can actually rise to lead). Otherwise the dynasty continues or a new one rises.
      let heir: HistoricalFigure | undefined;
      if (s.detailed && s.id === world.focusedSettlementId) {
        const heirId = chooseHeir(world, s.id);
        if (heirId !== undefined) heir = crownActor(world, s, heirId, year, rng);
      }
      if (!heir) {
        const continues = oldHouse !== undefined && oldHouse.extinctYear === undefined && !rng.chance(DYNASTY_TURNOVER);
        heir = mintFigure(world, s, year, rng, 'ruler', continues ? oldHouse!.name : undefined);
      }
      installRuler(world, s, heir, oldHouse, year, title);

      // Contested succession: when power crosses faction lines, note it.
      // Both parties must be real actors (personality.has) — minted figures have
      // no value profiles, so the check is silently skipped for aggregate settlements.
      if (world.factionSplit) {
        const split = world.factionSplit;
        const ax = split.axis; // string index into Record<string, number>
        const oldPers = world.personality.get(ruler.id);
        const newPers = world.personality.get(heir.id);
        if (oldPers && newPers) {
          const oldHigh = (oldPers.values[ax] ?? 0) >= split.axisMean;
          const newHigh = (newPers.values[ax] ?? 0) >= split.axisMean;
          if (oldHigh !== newHigh) {
            emit(world, 'contested_succession', [heir.id], {
              settlement: s.name,
              axis: ax,
              newFaction: newHigh ? split.highName : split.lowName,
              oldFaction: oldHigh ? split.highName : split.lowName,
            }, [], [s.id]);
            startCivilWarClock(world, s);
          }
        }
      }
    }
  }

  world.figureRngState = rng.state;
}
