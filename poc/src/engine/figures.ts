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
import { propagateCoronation } from './news';
import { maturityOf, ambitionOf, governmentById, leaderTitleOf, reignSpan, HEIR_WEIGHTS } from './pack';
import { givenName, houseName } from './pack';
import { startCivilWarClock } from './factions';
import { appointLeader, dissolve, getOrganization } from './organization';

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
export function endHouseAt(world: World, settlement: Settlement, year: number, cause?: number): void {
  const ruler = getFigure(world, settlement.currentRulerId);
  const house = houseById(world, ruler?.houseId);
  if (!house || house.extinctYear !== undefined) return;
  house.seatSettlementId = undefined;
  house.extinctYear = year;
  // the House falls because the city fell (the conquest/ruin event, when the caller knows it);
  // and the polity it seated dissolves in turn — a traceable chain of collapse.
  const fallEv = emit(world, 'house_fallen', [], { house: house.name, settlement: settlement.name }, cause !== undefined ? [cause] : [], [settlement.id]);
  dissolve(world, settlement.polityId, year, [fallEv]);
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
  // draw the given name first (preserve the rng order); take the house surname if one was
  // supplied, else FOUND a new House — a meaningful epithet, whose meaning we remember.
  const given = givenName(s.cultureId, world.seed, rng);
  let surname = family;
  if (surname === undefined) {
    const h = houseName(s.cultureId, world.seed, rng);
    surname = h.name;
    world.houseMeaning.set(surname, h.meaning);
  }
  const name = `${given} ${surname}`;
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

/** A contender for a settlement's seat, with the standing the polity weighs. */
export interface Claimant {
  id: EntityId;
  prominence: number; // ambition (do they want it) + renown (how the town regards them)
  ties: number; // their place in the community — the tiebreak
}

/** The living adults who could inherit a settlement's rule, ranked as the polity would rank them:
 *  by PROMINENCE (ambition + renown), ties breaking a tie, lowest id breaking that. This is the
 *  succession race, made a first-class read so it can be both DECIDED (chooseHeir) and SHOWN (the
 *  'rise' ambition surfaces where the player stands). Deterministic — no RNG, total ordering. */
export function rankClaimants(world: World, settlementId: number): Claimant[] {
  const out: Claimant[] = [];
  for (const id of fullActors(world)) {
    if (world.homeSettlement.get(id) !== settlementId) continue;
    if (world.lifecycle.get(id)!.ageYears < maturityOf(world.identity.get(id)!.speciesId)) continue;
    const prominence = ambitionOf(world.traits.get(id)!) * HEIR_WEIGHTS.ambition + standingOf(world, id) * HEIR_WEIGHTS.renown;
    out.push({ id, prominence, ties: relCount(world, id) });
  }
  // prominence desc, then ties desc, then id asc — identical to the old strict-`>` scan over the
  // id-ordered actors (so heir selection, and the determinism hash, are unchanged).
  out.sort((a, b) => b.prominence - a.prominence || b.ties - a.ties || a.id - b.id);
  return out;
}

/** The local heir to a settlement's rule: the front-runner of the succession race (see
 *  rankClaimants). With nobody renowned this reduces to the old ambition-first, ties-tiebreak
 *  order. Deterministic — no RNG. */
export function chooseHeir(world: World, settlementId: number): EntityId | undefined {
  return rankClaimants(world, settlementId)[0]?.id;
}

/** Years before a ruler's fated end that the seat counts as "failing" — the peaceful window in
 *  which the acclaimed front-runner may press a claim and the succession comes early. Shared with
 *  the 'rise' ambition so what the player is TOLD and what pressClaim ALLOWS never drift. */
export const CLAIM_RIPE_WINDOW = 6;

/**
 * A proactive, PEACEFUL bid for a seat. When the claimant is the one the town would raise (the
 * front-runner) AND the sitting ruler is failing (near the end of their days or term), the polity
 * turns to them and the succession comes early — the old ruler yields, and lives on. Any other
 * press is premature and does nothing (the forceful, contested path — challenging firm power into a
 * civil war — is a later stage). ONE RULE SET: an ambitious NPC noble presses a claim by this very
 * verb; there is no player branch. Randomness (the new reign's span) comes from the caller's stream.
 */
export function pressClaim(world: World, claimant: EntityId, rng: Rng): void {
  const h = world.homeSettlement.get(claimant);
  if (h === undefined) return;
  const s = world.settlements[h];
  if (!s || s.ruinedYear !== undefined || s.macro.population <= 0) return;
  if (s.currentRulerId === claimant) return; // already yours
  if (governmentById(s.governmentId).succession === 'none') return; // a leaderless polity has no seat
  if (rankClaimants(world, h)[0]?.id !== claimant) return; // you must be the one they'd raise
  const year = Math.floor(world.tick / DAYS_PER_YEAR);
  const ruler = getFigure(world, s.currentRulerId);
  if (ruler && year < ruler.reignEnd - CLAIM_RIPE_WINDOW) return; // the moment is not yet ripe

  const oldHouse = houseById(world, ruler?.houseId);
  const title = leaderTitleOf(s.governmentId);
  const claimEv = emit(world, 'claim_pressed', [claimant], { settlement: s.name, title }, [], [s.id]);
  if (ruler && ruler.deathYear === undefined) ruler.reignEnd = year; // the old ruler yields, and lives on
  const heir = crownActor(world, s, claimant, year, rng);
  installRuler(world, s, heir, oldHouse, year, title, [claimEv]); // seats them; the ascension cites the claim
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
  causes: number[] = [], // the ruler's death (for hereditary succession) — the "why?"
): number {
  let evId: number;
  if (oldHouse && oldHouse.extinctYear === undefined && surnameOf(heir.name) === oldHouse.name) {
    heir.houseId = oldHouse.id;
    oldHouse.prestige += HOUSE_ASCEND;
    oldHouse.seatSettlementId = s.id;
    s.currentRulerId = heir.id;
    evId = emit(world, 'ascension', [heir.id], { settlement: s.name, title, house: oldHouse.name }, causes, [s.id]);
  } else {
    const newHouse = foundHouse(world, heir, s.id, year);
    if (oldHouse && oldHouse.seatSettlementId === s.id) oldHouse.seatSettlementId = undefined; // out of power
    s.currentRulerId = heir.id;
    evId = emit(world, 'dynasty', [heir.id], { settlement: s.name, title, house: newHouse.name, old: oldHouse?.name ?? '' }, causes, [s.id]);
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
  // …and word of it begins travelling the map objectively, arriving at each settlement by travel
  // time (the News Frontier). Nothing consumes this yet — it is the objective layer beneath belief.
  propagateCoronation(world, s.id, heir.id);

  // a heir who is a real SIMULATED actor (rose from the focused settlement, not a minted
  // record) earns ASCENSION renown — a public elevation the whole town knows. This feeds
  // the renown→opportunity loop: standing helped raise them, and rule now lifts it further.
  if (world.identity.has(heir.id)) {
    let residents = 0;
    for (const id of fullActors(world)) if (world.homeSettlement.get(id) === s.id) residents++;
    recordDeed(world, heir.id, 'ascension', { witnesses: residents, cause: evId });
  }
  return evId; // the succession event — so a contested succession can name it as its cause
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
    // an annexed PROVINCE (its polity's seat is another town) is ruled from the capital — it
    // raises no local line of its own (2E annexation). Its polity's succession runs at the seat.
    const owner = getOrganization(world, s.polityId);
    if (owner && owner.seatId !== undefined && owner.seatId !== s.id) continue;
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
      let deathEv: number | undefined;
      if (gov.succession === 'hereditary') {
        ruler.deathYear = year;
        if (oldHouse) oldHouse.prestige += HOUSE_REIGN + (year - ruler.reignStart); // a completed reign
        deathEv = emit(world, 'ruler_died', [ruler.id], { settlement: s.name, title }, [], [s.id]);
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
      const succEv = installRuler(world, s, heir, oldHouse, year, title, deathEv !== undefined ? [deathEv] : []);

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
            const contestedEv = emit(world, 'contested_succession', [heir.id], {
              settlement: s.name,
              axis: ax,
              newFaction: newHigh ? split.highName : split.lowName,
              oldFaction: oldHigh ? split.highName : split.lowName,
            }, [succEv], [s.id]);
            startCivilWarClock(world, s, contestedEv); // the war, if it comes, traces here
          }
        }
      }
    }
  }

  world.figureRngState = rng.state;
}
