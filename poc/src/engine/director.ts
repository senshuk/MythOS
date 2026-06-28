/**
 * The AI Director / Storyteller — the biggest storytelling lever (RimWorld's
 * idea, adapted and kept deterministic). It does NOT script outcomes; it paces
 * *drama*. Each year it reads how much memorable drama the world has produced
 * lately (straight from the Chronicle's interest scores), builds **tension**
 * during calm stretches, and — when tension crosses a threshold — fires one
 * **incident** (a boon, a hard year, a plague) to punctuate the lull. When the
 * world is already dramatic on its own, tension stays low and the director holds
 * back: setback → recovery → escalation, without piling on.
 *
 * Personalities (Balanced / Grim / Gentle / Chaotic) are pure data. The director
 * runs on its own RNG stream, so its pacing is independent of which settlement the
 * player is watching, and fully reproducible.
 */
import { type World, type MacroPop, type Settlement, type DirectorState, DAYS_PER_YEAR } from './model';
import { Rng } from './rng';
import { fullActors, emit, clamp } from './world';
import { killActor } from './world';
import { standAgainst } from './perception';
import { expand } from './grammar';
import { WONDER_GRAMMAR, BEAST_GRAMMAR, OMEN_GRAMMAR, BOONS } from '../content/narrative';

interface DirectorDef {
  id: string;
  label: string;
  tensionGain: number; // pressure built per calm year
  trigger: number; // tension needed to fire an incident
  positiveBias: number; // P(an incident is a boon rather than a hardship)
  intensity: number; // scales incident magnitude
  minGap: number; // min years between incidents
  plagueChance: number; // among hardships, chance of a plague vs a hard year
}

const DIRECTORS: Record<string, DirectorDef> = {
  balanced: { id: 'balanced', label: 'Even-Handed', tensionGain: 14, trigger: 48, positiveBias: 0.45, intensity: 1.0, minGap: 2, plagueChance: 0.3 },
  grim: { id: 'grim', label: 'Cruel', tensionGain: 18, trigger: 38, positiveBias: 0.22, intensity: 1.5, minGap: 1, plagueChance: 0.45 },
  gentle: { id: 'gentle', label: 'Merciful', tensionGain: 9, trigger: 72, positiveBias: 0.72, intensity: 0.7, minGap: 3, plagueChance: 0.12 },
  chaotic: { id: 'chaotic', label: 'Capricious', tensionGain: 20, trigger: 34, positiveBias: 0.5, intensity: 1.35, minGap: 1, plagueChance: 0.4 },
};

export const DIRECTOR_OPTIONS = Object.values(DIRECTORS).map((d) => ({ id: d.id, label: d.label }));

export function directorDef(id: string): DirectorDef {
  return DIRECTORS[id] ?? DIRECTORS.balanced;
}

export function setStoryteller(world: World, id: string): void {
  if (DIRECTORS[id]) world.director.personality = id;
}

export function directorMood(world: World): string {
  const def = directorDef(world.director.personality);
  const yr = Math.floor(world.tick / DAYS_PER_YEAR);
  if (world.director.lastIncidentYear === yr) return 'fate stirs';
  if (world.director.tension >= def.trigger * 0.8) return 'omens gather';
  if (world.director.tension <= def.trigger * 0.3) return 'the age is quiet';
  return 'an even age';
}

/** Yearly pacing pass. */
export function directorYearly(world: World): void {
  const st = world.director;
  const def = directorDef(st.personality);
  const rng = new Rng(world.directorRngState);
  const yr = Math.floor(world.tick / DAYS_PER_YEAR);

  // recent *natural* drama (from the chronicle) relieves the urge to manufacture more —
  // NORMALISED by world size, so a big world's busy chronicle doesn't permanently suppress
  // the storyteller (it paces drama per-region, not by raw event volume).
  let recentDrama = 0;
  for (const t of world.chronicle) if (yr - t.year <= 3) recentDrama += t.interest;
  const scale = Math.max(1, world.settlements.length / 12);

  st.tension = clamp(st.tension + def.tensionGain - (recentDrama / scale) * 0.06, 0, 200);

  if (st.tension >= def.trigger && yr - st.lastIncidentYear >= def.minGap) {
    const before = world.events.length;
    fireIncident(world, def, rng);
    // only a fired incident that actually LANDED (emitted an event, i.e. found a valid
    // target) counts and relieves tension; a no-op attempt simply retries next year.
    if (world.events.length > before) {
      st.tension -= def.trigger * 0.75;
      st.lastIncidentYear = yr;
      st.incidents += 1;
    }
  }

  world.directorRngState = rng.state;
}

function fireIncident(world: World, def: DirectorDef, rng: Rng): void {
  if (rng.chance(0.12)) {
    omen(world, rng); // an occasional portent (flavor, low stakes)
    return;
  }
  if (rng.chance(def.positiveBias)) {
    if (rng.chance(0.35)) wonder(world, def, rng); // a great work raised
    else goodYear(world, def, rng);
  } else if (rng.chance(def.plagueChance)) {
    plague(world, def, rng);
  } else if (rng.chance(0.45)) {
    beast(world, def, rng); // a legendary beast attacks
  } else {
    hardYear(world, def, rng);
  }
}

function pickPopulated(world: World, rng: Rng): Settlement | undefined {
  const live = world.settlements.filter((s) => s.ruinedYear === undefined && s.macro.population > 0);
  return live.length ? live[rng.int(live.length)] : undefined;
}

/** A prosperous, stable settlement raises a great work — a positive permanent
 *  landmark to balance the disasters. */
function wonder(world: World, def: DirectorDef, rng: Rng): void {
  let where: Settlement | undefined;
  let best = -1;
  for (const s of world.settlements) {
    if (s.ruinedYear !== undefined || s.macro.population < 40) continue;
    const score = s.econ.wealth + s.macro.stability * 4;
    if (score > best) {
      best = score;
      where = s;
    }
  }
  if (!where) return;
  where.macro.stability = clamp(where.macro.stability + 3, -100, 100);
  where.econ.wealth += 120 * def.intensity; // a great work brings renown & wealth
  const subjects = where.currentRulerId !== undefined ? [where.currentRulerId] : [];
  emit(world, 'wonder', subjects, { name: where.name, wonder: expand(WONDER_GRAMMAR, 'wonder', rng, { PLACE: where.name }) }, [], [where.id]);
}

/** A legendary beast ravages a settlement. */
function beast(world: World, def: DirectorDef, rng: Rng): void {
  const s = pickPopulated(world, rng);
  if (!s) return;
  const toll = Math.round(rng.range(10, 30) * def.intensity);
  bandKill(s.macro, toll);
  s.macro.population = s.macro.children + s.macro.adults + s.macro.elders;
  s.macro.stability = clamp(s.macro.stability - rng.range(6, 14), -100, 100);
  const beastId = emit(world, 'beast', [], { name: s.name, beast: expand(BEAST_GRAMMAR, 'beast', rng, {}), toll }, [], [s.id]);
  // if the beast fell on the FOCUSED town, its bravest soul stands against it and earns
  // valour (perception is off the shared stream, so this doesn't perturb the director RNG).
  if (s.detailed && s.id === world.focusedSettlementId) standAgainst(world, beastId, s.id);
}

/** A strange portent — flavor, no mechanical effect. */
function omen(world: World, rng: Rng): void {
  const s = pickPopulated(world, rng);
  if (!s) return;
  emit(world, 'omen', [], { name: s.name, omen: expand(OMEN_GRAMMAR, 'omen', rng, {}) }, [], [s.id]);
}

function goodYear(world: World, def: DirectorDef, rng: Rng): void {
  const boost = Math.max(1, Math.round(4 * def.intensity));
  for (const s of world.settlements) {
    if (!s.detailed && s.macro.population > 0) s.macro.stability = clamp(s.macro.stability + boost, -100, 100);
  }
  const where = representativeSettlement(world);
  if (where) {
    where.econ.wealth += 180 * def.intensity;
    emit(world, 'boon', [], { kind: BOONS[rng.int(BOONS.length)], name: where.name }, [], [where.id]);
  }
}

/** The settlement a world-level boon is named after: the focused one if there is
 *  one (play), else the largest populated settlement (headless / worldgen). */
function representativeSettlement(world: World) {
  if (world.focusedSettlementId >= 0) return world.settlements[world.focusedSettlementId];
  let best: (typeof world.settlements)[number] | undefined;
  for (const s of world.settlements) {
    if (s.macro.population <= 0) continue;
    if (!best || s.macro.population > best.macro.population) best = s;
  }
  return best;
}

function hardYear(world: World, def: DirectorDef, rng: Rng): void {
  const aggs = world.settlements.filter((s) => !s.detailed && s.macro.population > 20);
  if (!aggs.length) return;
  const s = aggs[rng.int(aggs.length)];
  const toll = Math.round(rng.range(8, 20) * def.intensity);
  bandKill(s.macro, toll);
  s.macro.population = s.macro.children + s.macro.adults + s.macro.elders;
  s.macro.stability = clamp(s.macro.stability - rng.range(4, 10), -100, 100);
  emit(world, 'blight', [], { name: s.name, toll }, [], [s.id]);
}

function plague(world: World, def: DirectorDef, rng: Rng): void {
  const live = fullActors(world);
  if (live.length > 25) {
    // a plague in the focused settlement kills named villagers — felt, and memorable
    const toll = Math.min(live.length - 12, Math.max(2, Math.round(rng.range(4, 10) * def.intensity)));
    for (let i = 0; i < toll; i++) {
      const victim = live[rng.int(live.length)];
      if (world.lifecycle.get(victim)!.alive) killActor(world, victim, world.tick, 'died', [], []);
    }
    emit(world, 'plague', [], { name: world.settlements[world.focusedSettlementId].name, toll }, [], [world.focusedSettlementId]);
    return;
  }
  const aggs = world.settlements.filter((s) => !s.detailed && s.macro.population > 40);
  if (!aggs.length) return;
  const s = aggs[rng.int(aggs.length)];
  const toll = Math.round(rng.range(20, 45) * def.intensity);
  bandKill(s.macro, toll);
  s.macro.population = s.macro.children + s.macro.adults + s.macro.elders;
  s.macro.stability = clamp(s.macro.stability - rng.range(8, 16), -100, 100);
  emit(world, 'plague', [], { name: s.name, toll }, [], [s.id]);
}

function bandKill(m: MacroPop, toll: number): void {
  let d = toll;
  const a = Math.min(m.adults, Math.round(d * 0.55));
  m.adults -= a;
  d -= a;
  const e = Math.min(m.elders, Math.round(d * 0.6));
  m.elders -= e;
  d -= e;
  m.children -= Math.min(m.children, d);
}

export function initialDirector(): DirectorState {
  return { personality: 'balanced', tension: 0, incidents: 0, lastIncidentYear: -99 };
}
