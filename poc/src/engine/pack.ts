/**
 * THE PACK BOUNDARY — the single point where the engine meets a universe.
 *
 * The engine simulates GENERIC concepts (species, cultures, governments, resources,
 * thoughts, intents, tongues); a UNIVERSE PACK supplies the specifics — which species
 * exist, what the creeds believe, how the tongues sound, what the map calls things.
 * Engine code imports every pack member from THIS module and never from content/
 * directly, so binding a different universe (Tolkien, sci-fi, …) is one setPack()
 * call at world creation — no engine change.
 *
 * The exports are LIVE BINDINGS (`export let` + reassignment in setPack): ES modules
 * propagate reassignment to every importer, so the whole engine re-resolves to the
 * new pack atomically. The default binding is the built-in fantasy pack, which also
 * DEFINES the required shape (`UniversePack` = its module types).
 *
 * NOTE: a save file does not yet record which pack built it (planned: packId+version
 * stamped in persistence); until then, load saves only under the pack that made them.
 */
import * as fixture from '../content/fixture';
import * as languages from '../content/languages';
import * as biomes from '../content/biomes';
import * as narrative from '../content/narrative';
import * as actions from '../content/actions';
import * as ambitions from '../content/ambitions';
import * as aspirations from '../content/aspirations';
import * as decisions from '../content/decisions';

// type re-exports (compile-time only; a pack supplies matching shapes)
export type { ReproductionMode, Reproduction, Species, Profession, Trait, SuccessionMode, Government, ValueAxis, TemperamentAxis, Personality, Deity, Precept, ActorLifeState, StatePrecept, Culture, WorldviewAxisId, BreakSpec } from '../content/fixture';
export type { PlaceContext } from '../content/languages';
export type { Biome } from '../content/biomes';
export type { RenderFn } from '../content/narrative';
export type { ActionResolver } from '../content/actions';

/** The COMPLETE surface a universe pack must supply — every function, table and constant
 * the engine consumes. Derived from the fantasy pack, its reference implementation. */
export type UniversePack = typeof fixture & typeof languages & typeof biomes & typeof narrative & typeof actions & typeof ambitions & typeof aspirations & typeof decisions;

/** The built-in fantasy universe — the default pack and the reference for the shape. */
export const FANTASY_PACK: UniversePack = { ...fixture, ...languages, ...biomes, ...narrative, ...actions, ...ambitions, ...aspirations, ...decisions };

// ---- live bindings: the ACTIVE pack, one export per member -----------------
// ES module exports are LIVE — setPack reassigns these and every engine importer
// sees the new universe. Engine code imports from HERE, never from content/ directly.
export let PACK_ID = FANTASY_PACK.PACK_ID;
export let PACK_VERSION = FANTASY_PACK.PACK_VERSION;
export let MODULES = FANTASY_PACK.MODULES;
export let SPECIES = FANTASY_PACK.SPECIES;
export let maturityOf = FANTASY_PACK.maturityOf;
export let elderhoodOf = FANTASY_PACK.elderhoodOf;
export let fertileWindowOf = FANTASY_PACK.fertileWindowOf;
export let PROFESSIONS = FANTASY_PACK.PROFESSIONS;
export let TRAITS = FANTASY_PACK.TRAITS;
export let TRAIT_SPECTRA = FANTASY_PACK.TRAIT_SPECTRA;
export let professionIncomeOf = FANTASY_PACK.professionIncomeOf;
export let ambitionOf = FANTASY_PACK.ambitionOf;
export let pairAffinity = FANTASY_PACK.pairAffinity;
export let GOVERNMENTS = FANTASY_PACK.GOVERNMENTS;
export let ORG_CATEGORY_POLITICAL = FANTASY_PACK.ORG_CATEGORY_POLITICAL;
export let POLITY_LABELS = FANTASY_PACK.POLITY_LABELS;
export let governmentById = FANTASY_PACK.governmentById;
export let pickGovernment = FANTASY_PACK.pickGovernment;
export let successionOf = FANTASY_PACK.successionOf;
export let leaderTitleOf = FANTASY_PACK.leaderTitleOf;
export let hasLeader = FANTASY_PACK.hasLeader;
export let reignSpan = FANTASY_PACK.reignSpan;
export let VALUES = FANTASY_PACK.VALUES;
export let TEMPERAMENTS = FANTASY_PACK.TEMPERAMENTS;
export let DEITIES = FANTASY_PACK.DEITIES;
export let deityById = FANTASY_PACK.deityById;
export let CULTURES = FANTASY_PACK.CULTURES;
export let cultureById = FANTASY_PACK.cultureById;
export let patronDeityOf = FANTASY_PACK.patronDeityOf;
export let faithProbability = FANTASY_PACK.faithProbability;
export let preceptFor = FANTASY_PACK.preceptFor;
export let ethicsWeightFor = FANTASY_PACK.ethicsWeightFor;
export let factionNames = FANTASY_PACK.factionNames;
export let pickCulture = FANTASY_PACK.pickCulture;
export let culturalDistance = FANTASY_PACK.culturalDistance;
export let mostOpposedValue = FANTASY_PACK.mostOpposedValue;
export let valueProfile = FANTASY_PACK.valueProfile;
export let temperamentProfile = FANTASY_PACK.temperamentProfile;
export let valueAlignment = FANTASY_PACK.valueAlignment;
export let temperamentAffinity = FANTASY_PACK.temperamentAffinity;
export let natureOf = FANTASY_PACK.natureOf;
export let EVALUATOR_VERSION = FANTASY_PACK.EVALUATOR_VERSION;
export let WORLDVIEW_AXES = FANTASY_PACK.WORLDVIEW_AXES;
export let worldviewFromValues = FANTASY_PACK.worldviewFromValues;
export let worldviewReading = FANTASY_PACK.worldviewReading;
export let INTENTS = FANTASY_PACK.INTENTS;
export let intentById = FANTASY_PACK.intentById;
export let intentLabel = FANTASY_PACK.intentLabel;
export let OPERATIONAL_KEYS = FANTASY_PACK.OPERATIONAL_KEYS;
export let baselineOperational = FANTASY_PACK.baselineOperational;
export let ACTIONS = FANTASY_PACK.ACTIONS;
export let actionById = FANTASY_PACK.actionById;
export let INTENT_TO_ACTION = FANTASY_PACK.INTENT_TO_ACTION;
export let ORG_INTERACTION = FANTASY_PACK.ORG_INTERACTION;
export let INTERACTIONS = FANTASY_PACK.INTERACTIONS;
export let INTENT_TO_INTERACTION = FANTASY_PACK.INTENT_TO_INTERACTION;
export let speciesById = FANTASY_PACK.speciesById;
export let pickSex = FANTASY_PACK.pickSex;
export let pairBondsFor = FANTASY_PACK.pairBondsFor;
export let isAsexual = FANTASY_PACK.isAsexual;
export let fecundityOf = FANTASY_PACK.fecundityOf;
export let macroFertilityOf = FANTASY_PACK.macroFertilityOf;
export let monogamousOf = FANTASY_PACK.monogamousOf;
export let canBear = FANTASY_PACK.canBear;
export let unionViable = FANTASY_PACK.unionViable;
export let pickTraits = FANTASY_PACK.pickTraits;
export let pickProfession = FANTASY_PACK.pickProfession;
export let pickFounderAge = FANTASY_PACK.pickFounderAge;
export let SETTLEMENT_LOCATION_TYPE = FANTASY_PACK.SETTLEMENT_LOCATION_TYPE;
export let TRAVEL_SPEED = FANTASY_PACK.TRAVEL_SPEED;
export let HAZARD_DELAY_TICKS = FANTASY_PACK.HAZARD_DELAY_TICKS;
export let RESOURCES = FANTASY_PACK.RESOURCES;
export let SUBSISTENCE_RESOURCE = FANTASY_PACK.SUBSISTENCE_RESOURCE;
export let PREMIUM_RESOURCE = FANTASY_PACK.PREMIUM_RESOURCE;
export let CONSUMPTION = FANTASY_PACK.CONSUMPTION;
export let BASE_PRICE = FANTASY_PACK.BASE_PRICE;
export let terrainYields = FANTASY_PACK.terrainYields;
export let specializationFromTerrain = FANTASY_PACK.specializationFromTerrain;
export let THOUGHT_SPECS = FANTASY_PACK.THOUGHT_SPECS;
export let thoughtSpec = FANTASY_PACK.thoughtSpec;
export let SELF_THOUGHT_SPECS = FANTASY_PACK.SELF_THOUGHT_SPECS;
export let selfThoughtSpec = FANTASY_PACK.selfThoughtSpec;
export let MOOD_NEED_WEIGHTS = FANTASY_PACK.MOOD_NEED_WEIGHTS;
export let MOOD_NEED_BAND_FACTOR = FANTASY_PACK.MOOD_NEED_BAND_FACTOR;
export let moodBaseline = FANTASY_PACK.moodBaseline;
export let MOOD_FEELS = FANTASY_PACK.MOOD_FEELS;
export let BREAKS = FANTASY_PACK.BREAKS;
export let breakThreshold = FANTASY_PACK.breakThreshold;
export let BREAK_CHANCE_MAX = FANTASY_PACK.BREAK_CHANCE_MAX;
export let BINGE_COST = FANTASY_PACK.BINGE_COST;
export let GIFT_COST = FANTASY_PACK.GIFT_COST;
export let GIFT_WEALTH_FLOOR = FANTASY_PACK.GIFT_WEALTH_FLOOR;
export let giveInclination = FANTASY_PACK.giveInclination;
export let REPUTE_SPECS = FANTASY_PACK.REPUTE_SPECS;
export let reputeSpec = FANTASY_PACK.reputeSpec;
export let ethicsTaboos = FANTASY_PACK.ethicsTaboos;
export let creedOf = FANTASY_PACK.creedOf;
export let REPUTATION_EFFECTS = FANTASY_PACK.REPUTATION_EFFECTS;
export let ORG_ECONOMY = FANTASY_PACK.ORG_ECONOMY;
export let HEIR_WEIGHTS = FANTASY_PACK.HEIR_WEIGHTS;
export let NEEDS = FANTASY_PACK.NEEDS;
export let SUBSISTENCE_NEED = FANTASY_PACK.SUBSISTENCE_NEED;
export let WEALTH_NEED = FANTASY_PACK.WEALTH_NEED;
export let SOCIAL_NEED = FANTASY_PACK.SOCIAL_NEED;
export let SAFETY_NEED = FANTASY_PACK.SAFETY_NEED;
export let ESTEEM_NEED = FANTASY_PACK.ESTEEM_NEED;
export let NEED_FEELS = FANTASY_PACK.NEED_FEELS;
export let NEED_FEELS_GENERIC = FANTASY_PACK.NEED_FEELS_GENERIC;
export let NEED_BEAT_LOW = FANTASY_PACK.NEED_BEAT_LOW;
export let NEED_BEAT_HIGH = FANTASY_PACK.NEED_BEAT_HIGH;
export let kitFor = FANTASY_PACK.kitFor;
export let voiceOf = FANTASY_PACK.voiceOf;
export let kinOf = FANTASY_PACK.kinOf;
export let tongueFor = FANTASY_PACK.tongueFor;
export let lexeme = FANTASY_PACK.lexeme;
export let featureName = FANTASY_PACK.featureName;
export let LEXICON_SAMPLE = FANTASY_PACK.LEXICON_SAMPLE;
export let peopleName = FANTASY_PACK.peopleName;
export let givenName = FANTASY_PACK.givenName;
export let houseName = FANTASY_PACK.houseName;
export let placeName = FANTASY_PACK.placeName;
export let BIOMES = FANTASY_PACK.BIOMES;
export let biomeOf = FANTASY_PACK.biomeOf;
export let EVENT_RENDER = FANTASY_PACK.EVENT_RENDER;
export let eventInterest = FANTASY_PACK.eventInterest;
export let renderBackstory = FANTASY_PACK.renderBackstory;
export let LANDMARK_TYPES = FANTASY_PACK.LANDMARK_TYPES;
export let LEGEND_GRAMMAR = FANTASY_PACK.LEGEND_GRAMMAR;
export let ERA_GRAMMAR = FANTASY_PACK.ERA_GRAMMAR;
export let ERA_SYMBOL = FANTASY_PACK.ERA_SYMBOL;
export let WONDER_GRAMMAR = FANTASY_PACK.WONDER_GRAMMAR;
export let BEAST_GRAMMAR = FANTASY_PACK.BEAST_GRAMMAR;
export let OMEN_GRAMMAR = FANTASY_PACK.OMEN_GRAMMAR;
export let BOONS = FANTASY_PACK.BOONS;
export let PLAYER_ACTIONS = FANTASY_PACK.PLAYER_ACTIONS;
export let EXTRA_ACTIONS = FANTASY_PACK.EXTRA_ACTIONS;
export let resolveExtraAction = FANTASY_PACK.resolveExtraAction;
export let AMBITIONS = FANTASY_PACK.AMBITIONS;
export let ASPIRATIONS = FANTASY_PACK.ASPIRATIONS;
export let DEFAULT_ASPIRATION = FANTASY_PACK.DEFAULT_ASPIRATION;
export let DECISIONS = FANTASY_PACK.DECISIONS;

/** Bind a universe: every engine import re-resolves to this pack from now on.
 * Called at world creation; the default (no call) is the fantasy pack. */
export function setPack(p: UniversePack): void {
  PACK_ID = p.PACK_ID;
  PACK_VERSION = p.PACK_VERSION;
  MODULES = p.MODULES;
  SPECIES = p.SPECIES;
  maturityOf = p.maturityOf;
  elderhoodOf = p.elderhoodOf;
  fertileWindowOf = p.fertileWindowOf;
  PROFESSIONS = p.PROFESSIONS;
  TRAITS = p.TRAITS;
  TRAIT_SPECTRA = p.TRAIT_SPECTRA;
  professionIncomeOf = p.professionIncomeOf;
  ambitionOf = p.ambitionOf;
  pairAffinity = p.pairAffinity;
  GOVERNMENTS = p.GOVERNMENTS;
  ORG_CATEGORY_POLITICAL = p.ORG_CATEGORY_POLITICAL;
  POLITY_LABELS = p.POLITY_LABELS;
  governmentById = p.governmentById;
  pickGovernment = p.pickGovernment;
  successionOf = p.successionOf;
  leaderTitleOf = p.leaderTitleOf;
  hasLeader = p.hasLeader;
  reignSpan = p.reignSpan;
  VALUES = p.VALUES;
  TEMPERAMENTS = p.TEMPERAMENTS;
  DEITIES = p.DEITIES;
  deityById = p.deityById;
  CULTURES = p.CULTURES;
  cultureById = p.cultureById;
  patronDeityOf = p.patronDeityOf;
  faithProbability = p.faithProbability;
  preceptFor = p.preceptFor;
  ethicsWeightFor = p.ethicsWeightFor;
  factionNames = p.factionNames;
  pickCulture = p.pickCulture;
  culturalDistance = p.culturalDistance;
  mostOpposedValue = p.mostOpposedValue;
  valueProfile = p.valueProfile;
  temperamentProfile = p.temperamentProfile;
  valueAlignment = p.valueAlignment;
  temperamentAffinity = p.temperamentAffinity;
  natureOf = p.natureOf;
  EVALUATOR_VERSION = p.EVALUATOR_VERSION;
  WORLDVIEW_AXES = p.WORLDVIEW_AXES;
  worldviewFromValues = p.worldviewFromValues;
  worldviewReading = p.worldviewReading;
  INTENTS = p.INTENTS;
  intentById = p.intentById;
  intentLabel = p.intentLabel;
  OPERATIONAL_KEYS = p.OPERATIONAL_KEYS;
  baselineOperational = p.baselineOperational;
  ACTIONS = p.ACTIONS;
  actionById = p.actionById;
  INTENT_TO_ACTION = p.INTENT_TO_ACTION;
  ORG_INTERACTION = p.ORG_INTERACTION;
  INTERACTIONS = p.INTERACTIONS;
  INTENT_TO_INTERACTION = p.INTENT_TO_INTERACTION;
  speciesById = p.speciesById;
  pickSex = p.pickSex;
  pairBondsFor = p.pairBondsFor;
  isAsexual = p.isAsexual;
  fecundityOf = p.fecundityOf;
  macroFertilityOf = p.macroFertilityOf;
  monogamousOf = p.monogamousOf;
  canBear = p.canBear;
  unionViable = p.unionViable;
  pickTraits = p.pickTraits;
  pickProfession = p.pickProfession;
  pickFounderAge = p.pickFounderAge;
  SETTLEMENT_LOCATION_TYPE = p.SETTLEMENT_LOCATION_TYPE;
  TRAVEL_SPEED = p.TRAVEL_SPEED;
  HAZARD_DELAY_TICKS = p.HAZARD_DELAY_TICKS;
  RESOURCES = p.RESOURCES;
  SUBSISTENCE_RESOURCE = p.SUBSISTENCE_RESOURCE;
  PREMIUM_RESOURCE = p.PREMIUM_RESOURCE;
  CONSUMPTION = p.CONSUMPTION;
  BASE_PRICE = p.BASE_PRICE;
  terrainYields = p.terrainYields;
  specializationFromTerrain = p.specializationFromTerrain;
  THOUGHT_SPECS = p.THOUGHT_SPECS;
  thoughtSpec = p.thoughtSpec;
  SELF_THOUGHT_SPECS = p.SELF_THOUGHT_SPECS;
  selfThoughtSpec = p.selfThoughtSpec;
  MOOD_NEED_WEIGHTS = p.MOOD_NEED_WEIGHTS;
  MOOD_NEED_BAND_FACTOR = p.MOOD_NEED_BAND_FACTOR;
  moodBaseline = p.moodBaseline;
  MOOD_FEELS = p.MOOD_FEELS;
  BREAKS = p.BREAKS;
  breakThreshold = p.breakThreshold;
  BREAK_CHANCE_MAX = p.BREAK_CHANCE_MAX;
  BINGE_COST = p.BINGE_COST;
  GIFT_COST = p.GIFT_COST;
  GIFT_WEALTH_FLOOR = p.GIFT_WEALTH_FLOOR;
  giveInclination = p.giveInclination;
  REPUTE_SPECS = p.REPUTE_SPECS;
  reputeSpec = p.reputeSpec;
  ethicsTaboos = p.ethicsTaboos;
  creedOf = p.creedOf;
  REPUTATION_EFFECTS = p.REPUTATION_EFFECTS;
  ORG_ECONOMY = p.ORG_ECONOMY;
  HEIR_WEIGHTS = p.HEIR_WEIGHTS;
  NEEDS = p.NEEDS;
  SUBSISTENCE_NEED = p.SUBSISTENCE_NEED;
  WEALTH_NEED = p.WEALTH_NEED;
  SOCIAL_NEED = p.SOCIAL_NEED;
  SAFETY_NEED = p.SAFETY_NEED;
  ESTEEM_NEED = p.ESTEEM_NEED;
  NEED_FEELS = p.NEED_FEELS;
  NEED_FEELS_GENERIC = p.NEED_FEELS_GENERIC;
  NEED_BEAT_LOW = p.NEED_BEAT_LOW;
  NEED_BEAT_HIGH = p.NEED_BEAT_HIGH;
  kitFor = p.kitFor;
  voiceOf = p.voiceOf;
  kinOf = p.kinOf;
  tongueFor = p.tongueFor;
  lexeme = p.lexeme;
  featureName = p.featureName;
  LEXICON_SAMPLE = p.LEXICON_SAMPLE;
  peopleName = p.peopleName;
  givenName = p.givenName;
  houseName = p.houseName;
  placeName = p.placeName;
  BIOMES = p.BIOMES;
  biomeOf = p.biomeOf;
  EVENT_RENDER = p.EVENT_RENDER;
  eventInterest = p.eventInterest;
  renderBackstory = p.renderBackstory;
  LANDMARK_TYPES = p.LANDMARK_TYPES;
  LEGEND_GRAMMAR = p.LEGEND_GRAMMAR;
  ERA_GRAMMAR = p.ERA_GRAMMAR;
  ERA_SYMBOL = p.ERA_SYMBOL;
  WONDER_GRAMMAR = p.WONDER_GRAMMAR;
  BEAST_GRAMMAR = p.BEAST_GRAMMAR;
  OMEN_GRAMMAR = p.OMEN_GRAMMAR;
  BOONS = p.BOONS;
  PLAYER_ACTIONS = p.PLAYER_ACTIONS;
  EXTRA_ACTIONS = p.EXTRA_ACTIONS;
  resolveExtraAction = p.resolveExtraAction;
  AMBITIONS = p.AMBITIONS;
  ASPIRATIONS = p.ASPIRATIONS;
  DEFAULT_ASPIRATION = p.DEFAULT_ASPIRATION;
  DECISIONS = p.DECISIONS;
}
