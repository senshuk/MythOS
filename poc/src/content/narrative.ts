/**
 * The PACK's narrative layer — this universe's VOCABULARY of events.
 *
 * The engine knows the *structure* of an event (a typed, dated, entity-referencing
 * record) and the *mechanism* of history (emit, causal graph, chronicle/annals
 * retention by interest, legend/era rendering via grammar). It does NOT know what
 * the events MEAN or how they READ — that lives here, in the pack:
 *
 *   - EVENT_RENDER  : how each event type reads as prose (English, medieval flavour).
 *   - eventInterest : how memorable each type is (drives what history keeps).
 *   - the grammars  : how ages are named, legends retold, and wonders/beasts/omens
 *                     coined.
 *
 * A different Universe Pack supplies a different narrative.ts (sci-fi prose, its own
 * memorable events, its own grammars) and the engine is unchanged. Event types are
 * plain strings, so a pack may also introduce entirely new kinds the engine has never
 * heard of — they render and score from the data below, with neutral fallbacks.
 */
import { type GrammarRules } from '../engine/grammar';
import { Rng } from '../engine/rng';
import type { BackstoryFacts } from '../engine/backstory';

/** Renders one event to prose. `n(i)` resolves the i-th subject's name; `d` is the
 *  event's data bag; `subjectCount` is how many subjects it carries. */
export type RenderFn = (n: (i: number) => string, d: Record<string, number | string>, subjectCount: number) => string;

/** How each culture value axis reads in prose (the cultural REASON behind a clash). */
const VALUE_PHRASE: Record<string, string> = {
  honor: 'honor',
  war: 'the ways of war',
  tradition: 'old tradition',
  freedom: 'freedom',
  nature: 'the wild',
  craft: 'the crafts',
};
/** " over the wild" — the cultural reason clause appended to a conflict, if present. */
const overReason = (d: Record<string, number | string>): string =>
  d.reason ? ` over ${VALUE_PHRASE[d.reason as string] ?? d.reason}` : '';

/** A ruler's steer, in prose (design/26 P4) — the org intent id → a course phrase. */
const POLICY_PHRASE: Record<string, string> = {
  remain_neutral: 'quiet, inward tending',
  expand: 'expansion',
  prepare_war: 'mobilisation for war',
  protect_border: 'shoring up the marches',
  trade: 'commerce with its neighbours',
  recruit: 'gathering strength',
};

export const EVENT_RENDER: Record<string, RenderFn> = {
  settlement_founded: (n, d, c) =>
    c ? `${d.name} was founded by ${n(0)} with ${d.population} souls.` : `The settlement of ${d.name} was founded with ${d.population} souls.`,
  ascension: (n, d) =>
    `${n(0)}${d.house ? ` of House ${d.house}` : ''} became ${d.title || 'ruler'} of ${d.settlement}.`,
  claim_pressed: (n, d) => `${n(0)} pressed a claim to lead ${d.settlement}, and the failing ${d.title || 'ruler'} yielded the seat.`,
  dynasty: (n, d) =>
    `${n(0)} of House ${d.house} seized ${d.settlement}${d.old ? `, ending the rule of House ${d.old}` : ''}, founding a new dynasty.`,
  inherited: (n, d) =>
    `${d.predecessor} was dead; ${n(0)}${d.house ? ` of House ${d.house}` : ''} took up the line.`,
  house_fallen: (_n, d) => `House ${d.house} fell with ${d.settlement} — its line ended.`,
  // storied objects (design/33): the heirloom's name is subjects[0], resolved via the
  // name registry — so the prose survives every age, and links to the object's card.
  object_forged: (n, d) => `${n(0)}${d.meaning ? `, “${d.meaning}”` : ''} — ${d.kind} — was forged in ${d.settlement} for House ${d.house}.`,
  object_seized: (n, d) => `${n(0)} was carried off from fallen ${d.settlement} — House ${d.victor} took it from House ${d.fallen}.`,
  object_lost: (n, d) => `${n(0)}, treasure of House ${d.house}, was lost when ${d.settlement} fell.`,
  // the mythic feedback loop (design/34): a tale, told widely enough, becomes an institution
  order_founded: (n, d) =>
    `${d.order} was founded in ${d.settlement} by ${n(0)} — ${d.believers} souls sworn to the tale that ${d.subject} ${d.tale}.`,
  // …and the institution acts: rites keep the tale alive; the sworn seek what was lost
  order_rite: (_n, d) => `${d.org} held the rite of its legend, and the tale of ${d.subject} was told again.`,
  order_search: (_n, d) => `${d.org} scoured the land for ${d.object}, and returned empty-handed.`,
  object_recovered: (_n, d) => `${d.org} found ${d.object} at last — borne home to ${d.settlement}, into the keeping of House ${d.house}.`,
  ruler_died: (n, d) => `${n(0)}, ${d.title || 'ruler'} of ${d.settlement}, passed away.`,
  prosperity: (_n, d) => `${d.name} enjoyed a prosperous year (now ${d.population} souls).`,
  hardship: (_n, d) => `${d.name} suffered hardship — ${d.toll} souls lost.`,
  milestone: (_n, d) => `${d.name} grew to ${d.population} souls.`,
  figure_passed: (_n, d) => `${d.name}, long remembered in ${d.settlement}, passed away at ${d.age}.`,
  boon: (_n, d) => `${d.kind} blessed ${d.name}.`,
  blight: (_n, d) => `A hard season struck ${d.name} — ${d.toll} lost.`,
  plague: (_n, d) => `Plague swept ${d.name} — ${d.toll} perished.`,
  ruined: (n, d, c) => (c ? `${d.name} fell to ruin under ${n(0)}, its last ruler.` : `${d.name} was abandoned, falling to ruin.`),
  battle: (_n, d) => `${d.a} and ${d.b} clashed in battle${overReason(d)}${d.heldByGround ? ', the ground turning back the greater host,' : ''} (${d.aToll} and ${d.bToll} fell).`,
  conquest: (n, d, c) =>
    c ? `${n(0)} of ${d.victor} conquered ${d.fallen}${overReason(d)}, razing it.` : `${d.victor} conquered ${d.fallen}${overReason(d)}, razing it.`,
  wonder: (_n, d) => `${d.wonder} was raised in ${d.name}.`,
  beast: (_n, d) => `${d.beast} ravaged ${d.name} — ${d.toll} slain.`,
  omen: (_n, d) => `Over ${d.name}, ${d.omen} — folk feared dark days.`,
  trade: (_n, d) => `Caravans (${d.goods} in goods) ran between ${d.from} and ${d.to}.`,
  raid: (_n, d) => `${d.raider} raided ${d.victim}${d.toll ? ` (${d.toll} lost)` : ''}${overReason(d)}.`,
  famine: (_n, d) => `Famine struck ${d.name} — ${d.toll} starved.`,
  focus_shift: (_n, d) => `Attention turned from ${d.from} to ${d.to}.`,
  emigrated: (n, d) => `${n(0)} left ${d.from} to settle in ${d.to}.`,
  immigrated: (n, d) => `${n(0)} arrived in ${d.to} from ${d.from}.`,
  born: (n, _d, c) => (c >= 3 ? `${n(0)} was born to ${n(1)} and ${n(2)}.` : `${n(0)} was born to ${n(1)}.`),
  died: (n, d) => `${n(0)} passed away${d.age !== undefined ? `, aged ${d.age}` : ''}${d.settlement ? ` in ${d.settlement}` : ''}.`,
  died_brawl: (n) => `${n(0)} was killed by ${n(1)} in a brawl.`,
  // social outcomes carry WHERE they happened when the town has raised a venue
  // for them (design/25) — "were married at the shrine of the Windwalker".
  married: (n, d) => `${n(0)} and ${n(1)} were married${d.venue ? ` at ${d.venue}` : ''}.`,
  widowed: (n) => `${n(0)} was widowed.`,
  // communal gatherings (design/27 §4) — a named crowd assembles at a venue.
  wedding: (n, d) => `The folk of ${d.settlement ?? 'the town'} gathered${d.venue ? ` at ${d.venue}` : ''} to see ${n(0)} and ${n(1)} wed.`,
  funeral: (n, d) => `${d.settlement ?? 'The town'} gathered to mourn ${n(0)}${d.venue ? ` at ${d.venue}` : ''}.`,
  feast: (_n, d) => `The folk of ${d.settlement ?? 'the town'} feasted${d.venue ? ` at ${d.venue}` : ''}.`,
  rite: (_n, d) => `The faithful of ${d.settlement ?? 'the town'} kept the rite${d.venue ? ` at ${d.venue}` : ''}.`,
  friendship: (n, d) => `${n(0)} and ${n(1)} became close friends${d.venue ? ` at ${d.venue}` : ''}.`,
  rivalry: (n) => `${n(0)} and ${n(1)} became rivals.`,
  feud: (n, d) => `A bitter feud broke out between ${n(0)} and ${n(1)}${d.venue ? ` at ${d.venue}` : ''}.`,
  dispute: (n) => `${n(0)} and ${n(1)} quarrelled.`,
  kindness: (n) => `${n(0)} did ${n(1)} a kindness.`,
  brawl: (n, d) => `${n(0)} and ${n(1)} came to blows${d.venue ? ` at ${d.venue}` : ''}.`,
  mental_break: (n, d, c) =>
    d.mode === 'lash_out' && c >= 2
      ? `${n(0)} broke under the weight of their sorrows and turned on ${n(1)}.`
      : d.mode === 'binge'
        ? `${n(0)} broke under the weight of their sorrows and drowned them for days.`
        : `${n(0)} broke under the weight of their sorrows and withdrew from the world.`,
  condemned: (n, d) => `${n(0)} was condemned by ${d.deity ?? 'the gods'} for their deed.`,
  apostasy: (n, d) => `${n(0)} renounced their faith in ${d.deity ?? 'the gods'}.`,
  converted: (n, d) => `${n(0)} found faith in ${d.deity ?? 'the gods'}.`,
  contested_succession: (n, d) =>
    `${n(0)} of ${d.newFaction ?? 'the new order'} took power in ${d.settlement}, wresting it from ${d.oldFaction ?? 'the old guard'}${d.axis ? ` in the struggle over ${VALUE_PHRASE[d.axis as string] ?? d.axis}` : ''}.`,
  civil_war: (_n, d) =>
    `${d.winner} seized control of ${d.settlement}, driving out ${d.loser} in open civil war over ${VALUE_PHRASE[d.axis as string] ?? d.axis}.`,
  exile: (n, d) =>
    `${n(0)} of ${d.faction ?? 'the old order'} was expelled from ${d.from} and fled to ${d.to}.`,
  return_from_exile: (n, d) =>
    `${n(0)} of ${d.faction ?? 'the old order'} returned to ${d.settlement} after ${d.yearsGone} years in exile.`,
  travel_started: (_n, d) =>
    `${d.vehicle} set out${d.dest ? ` for ${d.dest}` : ''}${d.eta ? ` (a journey of ${d.eta} days)` : ''}.`,
  travel_arrived: (_n, d) =>
    `${d.vehicle} arrived${d.dest ? ` at ${d.dest}` : ''}${d.days ? ` after ${d.days} days` : ''}.`,
  travel_delayed: (_n, d) => `${d.vehicle} was delayed on its journey${d.by ? ` by ${d.by} days` : ''}.`,
  polity_founded: (_n, d) => `The ${d.name} was established${d.seat ? `, seated at ${d.seat}` : ''}.`,
  polity_dissolved: (_n, d) => `The ${d.name} was dissolved.`,
  // organizational ACTIONS (2D) — only completed outcomes become history (invariant 9).
  org_recruited: (_n, d) => `The ${d.org} raised ${d.levies} levies.`,
  org_fortified: (_n, d) => `The ${d.org} strengthened its defences.`,
  org_patrol: (_n, d) => `The ${d.org} set patrols on its marches.`,
  org_trade_pact: (_n, d) => `The ${d.org} opened a trade pact with ${d.with}.`,
  org_festival: (_n, d) => `The ${d.org} held a great festival.`,
  // AUDIENCES at the seat (design/26 P2) — a ruler's verdicts are public history.
  judgment: (n, d) =>
    d.verdict === 'reconcile'
      ? `${n(0)} judged the feud between ${n(1)} and ${n(2)}, and bade them make peace${d.venue ? ` at ${d.venue}` : ''}.`
      : `${n(0)} judged for ${n(1)} against ${n(2)}${d.venue ? ` at ${d.venue}` : ''}.`,
  shrine_funding: (n, d) => `${n(0)} endowed ${d.venue ?? 'the shrine'} with ${d.amount} from the treasury.`,
  petition_dismissed: (n) => `${n(0)} turned the petitioners away from the seat.`,
  polity_steered: (n, d) => `${n(0)} set the polity on a new course: ${POLICY_PHRASE[String(d.intent)] ?? String(d.intent)}.`,
  // negotiated interactions (2E) — one event, two histories: each court keeps its own account.
  pact_sealed: (_n, d) => `The ${d.a} and the ${d.b} sealed ${d.kind === 'peace' ? 'a pact of peace' : d.kind === 'alliance' ? 'an alliance' : 'a trade agreement'}.`,
  pact_refused: (_n, d) => `The ${d.b} refused the ${d.a}'s offer of ${d.kind === 'peace' ? 'peace' : d.kind === 'alliance' ? 'alliance' : 'trade'}.`,
  tribute_paid: (_n, d) => `The ${d.b} paid tribute of ${d.amount} to the ${d.a}.`,
  tribute_refused: (_n, d) => `The ${d.b} defied the ${d.a}'s demand for tribute.`,
  // mutual defense with real force (2E alliance): an ally answers the call and turns a razing aside.
  alliance_answered: (_n, d) => `The ${d.ally} answered the call, marching to the defense of ${d.defended} against ${d.against}.`,
  // annexation (2E): a victor takes a rival's seat instead of razing it — the town survives as a province.
  annexed: (_n, d) => `The ${d.victor} annexed ${d.annexed}, which now answers to the ${d.realm}.`,
  // formal wars (2E): declared when a clash becomes open war, joined by allies, resolved with terms.
  war_declared: (_n, d) => `War broke out between the ${d.aggressor} and the ${d.defender}.`,
  war_joined: (_n, d) => `The ${d.ally} entered the war at the side of the ${d.friend}.`,
  war_ended: (_n, d) => d.outcome === 'victory'
    ? `The war ended in victory for the ${d.victor}; the ${d.loser} sued for peace${Number(d.tribute) > 0 ? ` and paid ${d.tribute} in reparations` : ''}.`
    : `The war between the ${d.a} and the ${d.b} guttered out in an uneasy peace.`,
};

/**
 * How memorable an event is (pure function of type + data — deterministic). Drives
 * what the Chronicle keeps and the Annals enshrine. Unknown types score 0 (routine).
 */
export function eventInterest(type: string, data: Record<string, number | string>): number {
  const toll = typeof data.toll === 'number' ? data.toll : 0;
  const age = typeof data.age === 'number' ? data.age : 0;
  switch (type) {
    case 'civil_war': return 65; // a community tearing itself apart — rival to conquest in drama
    case 'object_seized': return 56; // plunder with a name — a dynasty's treasure changing hands
    case 'object_lost': return 50; // a named relic vanishing — the seed of every treasure-tale
    case 'object_forged': return 40; // an heirloom enters the world — annals-worthy, quietly
    case 'order_founded': return 58; // a tale become an institution — the mythic loop closing
    case 'order_rite': return 16; // recurring devotion — felt locally, not annals-worthy
    case 'order_search': return 30; // an expedition rides out — a quest in motion
    case 'object_recovered': return 62; // the quest fulfilled — annals-worthy
    case 'return_from_exile': return 58; // a triumphant return — dramatic resolution of the exile arc
    case 'exile': return 52; // a named expulsion — memorable consequence, below a brawl death
    case 'contested_succession': return 42; // a power shift between factions — between ascension and dynasty
    case 'condemned':
      return 55; // a named divine condemnation is notable but not as grave as a death
    case 'judgment':
      return 30; // a ruling from the seat is town news — remembered by both parties
    case 'shrine_funding':
      return 22; // public piety, quietly notable
    case 'petition_dismissed':
      return 8; // a closed door is minor news
    case 'polity_steered':
      return 26; // a turn in a polity's course is town news
    case 'apostasy':
      return 18; // renouncing faith is personal — comparable to a marriage or ascension
    case 'converted':
      return 10; // finding faith is quiet — visible in the recent feed, not the annals
    case 'died_brawl':
      return 72;
    case 'mental_break':
      return 22; // a neighbour losing their grip is village-memorable, below a death
    case 'conquest':
      return 64; // one settlement razing another — a landmark of war
    case 'ruined':
      return 62; // a settlement falling is a landmark of the age
    case 'beast':
      return 56;
    case 'wonder':
      return 50; // a great work — a positive landmark
    case 'battle':
      return 44;
    case 'plague':
      return 58 + Math.min(30, toll);
    case 'famine':
      return 48 + Math.min(40, toll);
    case 'blight':
      return 34 + Math.min(24, toll);
    case 'boon':
      return 30;
    case 'feud':
      return 46;
    case 'raid':
      return 28 + Math.min(34, toll * 2);
    case 'settlement_founded':
      return 38;
    case 'ruler_died':
      return 40; // a ruler's passing is remembered
    case 'ascension':
      return 18; // a new ruler rising is minor news
    case 'claim_pressed':
      return 34; // a bid for power, taken not inherited — notable, below a full dynastic turn
    case 'inherited':
      return 30; // a line passing to its heir — a quiet generational turning, kept in memory
    case 'dynasty':
      return 44; // a new dynasty seizing a seat — a turn of the age
    case 'house_fallen':
      return 48; // a great house ending — long remembered
    case 'figure_passed':
      return 40;
    case 'milestone':
      return 24;
    case 'died':
      return age >= 80 ? 26 : age >= 60 ? 16 : 6; // a long life is remembered
    case 'married':
      return 16;
    // communal gatherings (design/27 §4) — a funeral's weight scales with how many came to
    // mourn (a beloved figure fills the square); a wedding/feast is warm local texture.
    case 'funeral':
      return 14 + Math.min(20, (typeof data.count === 'number' ? data.count : 0) * 2);
    case 'wedding':
      return 10;
    case 'feast':
    case 'rite':
      return 8;
    case 'prosperity':
      return 12;
    case 'rivalry':
      return 12;
    case 'omen':
      return 16; // a portent — minor, but it stirs the feed
    case 'travel_delayed':
      return 14; // a journey interrupted — piracy/storm/breakdown stirs the feed
    case 'travel_arrived':
      return 6; // a journey completed — routine unless the cargo/passengers matter
    case 'travel_started':
      return 4; // setting out — minor news
    case 'polity_founded':
      return 36; // a government established — a landmark beside the settlement's founding
    case 'polity_dissolved':
      return 46; // a government falling — long remembered, beside its seat's ruin
    // organizational actions — modest history: visible in the feed, a small drama signal,
    // far below the landmark deeds (war/ruin) that will come when actions reshape the world.
    case 'org_trade_pact':
      return 18; // a pact between powers — the most notable of the bounded actions
    case 'org_festival':
      return 16;
    case 'org_recruited':
    case 'org_fortified':
      return 12;
    case 'org_patrol':
      return 10;
    // negotiated interactions (2E) — pacts and tributes are the stuff of chronicles
    case 'tribute_paid':
      return 34; // a power bending the knee (in coin) — memorable
    case 'pact_sealed':
      return 30;
    case 'tribute_refused':
      return 28; // defiance of a stronger neighbour — the seed of wars
    case 'annexed':
      return 39; // a realm swallowing a rival whole — the map itself redrawn
    case 'war_declared':
      return 40; // open war between powers — a defining turn of an age
    case 'alliance_answered':
      return 36; // a coalition turning a conquest aside — the stuff of legend
    case 'war_ended':
      return 35;
    case 'war_joined':
      return 30;
    case 'pact_refused':
      return 14;
    default:
      return 0; // born, friendship, dispute, kindness, brawl, trade, migration, focus…
  }
}

/** Event types that are permanent landmarks of an age, kept in the Annals forever. */
export const LANDMARK_TYPES = new Set<string>(['settlement_founded', 'ruined', 'conquest', 'wonder']);

// --- Grammars: how this universe names its ages, retells its legends, and coins
//     the names of its wonders, beasts, and omens. ---

/** A legend frame wraps the rendered event ([event]) in varied retelling phrasing. */
export const LEGEND_GRAMMAR: GrammarRules = {
  legend: [
    'Folk still tell of how [event].',
    'It is remembered that [event].',
    'Old songs recall how [event].',
    'They say [event].',
    'In time the tale spread that [event].',
    'The elders speak of the day [event].',
    'A grim ballad recalls how [event].',
    'Children are told how [event].',
    'It passed into legend: [event].',
    'Long after, folk still whispered how [event].',
  ],
};

/** Each kind of defining event has several possible era namings. */
export const ERA_GRAMMAR: GrammarRules = {
  era_famine: ['the Year of Famine in [PLACE]', 'the Hungry Year of [PLACE]', 'the Year [PLACE] Starved'],
  era_slain: ['the Year [VICTIM] was slain', 'the Year [VICTIM] fell', "the Year of [VICTIM]'s Murder"],
  era_raid: ['the Year [RAIDER] raided [VICTIM]', 'the Year [RAIDER] fell upon [VICTIM]', 'the [RAIDER]–[VICTIM] Raids'],
  era_feud: ['the Year the [A]–[B] feud erupted', 'the Year [A] and [B] turned to blood', 'the Year of the [A]–[B] Quarrel'],
  era_founded: ['the Founding of [PLACE]', 'the Year [PLACE] was Raised', 'the First Year of [PLACE]'],
  era_passed: ['the Year [PLACE] passed', 'the Passing of [PLACE]'],
  era_milestone: ['the Year [PLACE] grew great', 'the Flowering of [PLACE]'],
  era_died: ['the Year [VICTIM] died', 'the Year [VICTIM] was laid to rest'],
  era_wed: ['the Year [A] and [B] wed', 'the Year of the [A]–[B] Union'],
  era_plague: ['the Year of Plague in [PLACE]', 'the Plague Year of [PLACE]', 'the Year the Sickness Took [PLACE]'],
  era_blight: ['the Hard Year of [PLACE]', 'the Year [PLACE] Suffered', 'the Lean Year of [PLACE]'],
  era_boon: ['the Golden Year of [PLACE]', 'the Year [PLACE] Prospered', 'the Bright Year of [PLACE]'],
  era_ruined: ['the Fall of [PLACE]', 'the Year [PLACE] Fell to Ruin', 'the Ruin of [PLACE]'],
  era_ruler_died: ['the Death of [VICTIM]', 'the Year [VICTIM] Passed', 'the Mourning of [VICTIM]'],
  era_civil_war: ['the Civil War of [PLACE]', 'the Year [PLACE] Tore Itself Apart', 'the Schism of [PLACE]'],
  era_exile: ['the Exile of [VICTIM]', 'the Year [VICTIM] was Cast Out', 'the Banishment of [VICTIM]'],
  era_return_from_exile: ['the Return of [VICTIM]', 'the Year [VICTIM] Came Home', 'the Homecoming of [VICTIM]'],
  era_conquest: ['the Conquest of [FALLEN]', 'the Year [FALLEN] was Conquered', 'the Sack of [FALLEN]'],
  era_battle: ['the Battle of [PLACE]', 'the Year [PLACE] Met War', 'the Clash at [PLACE]'],
  era_wonder: ['the Raising of [WONDER]', 'the Building of [WONDER]', 'the Year [WONDER] was Made'],
  era_beast: ['the Coming of [BEAST]', 'the Year [BEAST] Attacked', 'the Terror of [BEAST]'],
  era_generic: ['the Year of [TYPE]'],
};

/** Which era-grammar symbol names a year defined by each event type. */
export const ERA_SYMBOL: Record<string, string> = {
  famine: 'era_famine',
  died_brawl: 'era_slain',
  raid: 'era_raid',
  feud: 'era_feud',
  settlement_founded: 'era_founded',
  figure_passed: 'era_passed',
  milestone: 'era_milestone',
  died: 'era_died',
  married: 'era_wed',
  plague: 'era_plague',
  blight: 'era_blight',
  boon: 'era_boon',
  ruined: 'era_ruined',
  ruler_died: 'era_ruler_died',
  civil_war: 'era_civil_war',
  exile: 'era_exile',
  return_from_exile: 'era_return_from_exile',
  conquest: 'era_conquest',
  battle: 'era_battle',
  wonder: 'era_wonder',
  beast: 'era_beast',
};

/** Names a director-raised great work. */
export const WONDER_GRAMMAR: GrammarRules = {
  wonder: ['the Great [hall] of [PLACE]', 'the [adj] [hall] of [PLACE]', 'the [material] [monument] of [PLACE]'],
  hall: ['Hall', 'Temple', 'Tower', 'Library', 'Spire', 'Citadel', 'Vault'],
  adj: ['Golden', 'Grand', 'Eternal', 'Hallowed', 'High', 'Shining'],
  material: ['Bronze', 'Marble', 'Onyx', 'Crystal', 'Iron', 'Silver'],
  monument: ['Colossus', 'Obelisk', 'Throne', 'Great Bell', 'Gate', 'Archive'],
};

/** Names a director-loosed legendary beast. */
export const BEAST_GRAMMAR: GrammarRules = {
  beast: ['the [badj] [creature]', '[bname] the [epithet]', 'the [badj] [creature]'],
  badj: ['Dread', 'Ancient', 'Black', 'Pale', 'Ravenous', 'Vile', 'Great'],
  creature: ['Wyrm', 'Drake', 'Serpent', 'Beast', 'Terror', 'Hydra', 'Wolf', 'Roc'],
  bname: ['Grimfang', 'Vorrath', 'Skarn', 'Maugrim', 'Ssylith', 'Korgath'],
  epithet: ['Devourer', 'Bloodmaw', 'Shadowmaw', 'the Unending', 'Ironhide', 'the Pale'],
};

/** A director portent (flavour). */
export const OMEN_GRAMMAR: GrammarRules = {
  omen: [
    'a comet streaked the night sky',
    'the sun was swallowed in eclipse',
    'the aurora burned blood-red',
    'two moons rose as one',
    'a calf was born with two heads',
    'the rivers ran red for a day',
    'stars fell like rain',
    'a great silence fell at midday',
  ],
};

/** Names for a bountiful director-blessed year (the `kind` of a `boon` event). */
export const BOONS = ['A bountiful harvest', 'A golden season', 'A time of plenty', 'Fair fortune', 'A mild and giving year'];

// ------------------------------------------------------ backstories ----------
// A life-story rendered from an actor's REAL history (engine/backstory gathers the facts).
// Each clause is grounded in something that actually happened — the lineage's fortune, the
// place's fate, the era that shaped them — and the whole reads like a RimWorld backstory but
// is TRUE to the world. Pack VOICE; a different universe rewrites the phrasing.

/** The lesson a dominant value teaches — the bent a backstory ties off with (two voicings each,
 *  so a region of like-minded folk doesn't read identically). */
const VALUE_LESSON: Record<string, [string, string]> = {
  craft: ['learned to make and to mend', 'took pride in good work'],
  war: ['learned to fight, and to fear little', 'came to trust the blade over the word'],
  honor: ['learned to keep their word above all', 'held their good name dear'],
  freedom: ['learned to answer to no one', 'chafed at any yoke'],
  nature: ['learned to heed the wild', 'kept close to the living land'],
  tradition: ['learned to keep the old ways', 'held to what the elders taught'],
};

function houseClause(f: BackstoryFacts): string {
  const h = f.house!;
  switch (f.houseFate) {
    case 'ruling': return `of the ruling House ${h}`;
    case 'fallen': return `of House ${h}, fallen from its high seat`;
    case 'ended': return `last of House ${h}, a line now ended`;
    case 'founding': return `founder of House ${h}`;
    default: return `of House ${h}`;
  }
}

function placeClause(f: BackstoryFacts): string {
  const p = f.place ?? 'a forgotten place';
  switch (f.placeFate) {
    case 'razed': return `${p}, now a ruin`;
    case 'founded': return `${p}, in the very year it was raised`;
    case 'ancient': return `ancient ${p}`;
    default: return p;
  }
}

/** How a formative-year event reads as the era that shaped someone (undefined = no real era). */
function eraPhrase(f: BackstoryFacts): string | undefined {
  const e = f.era;
  if (!e) return undefined;
  switch (e.type) {
    case 'famine': return `through the famine of y${e.year}`;
    case 'plague': case 'blight': return 'through the plague years';
    case 'beast': return `in the year a ${e.data.beast ?? 'beast'} stalked the land`;
    case 'conquest': return `in the shadow of the sack of ${e.data.fallen ?? 'a neighbour'}`;
    case 'battle': case 'raid': case 'civil_war': return `amid the wars of y${e.year}`;
    case 'prosperity': case 'boon': case 'wonder': return `in the golden years of y${e.year}`;
    case 'ruined': return 'as their home fell to ruin';
    default: return undefined;
  }
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Render an actor's gathered facts into a short life-story, in this universe's voice.
 *  `rng` (seeded stably per actor by the caller) picks interchangeable phrasings so the
 *  same soul always reads the same. */
export function renderBackstory(f: BackstoryFacts, rng: Rng): string {
  // 1) ORIGIN — name, lineage, trade, place.
  const lineage = f.house ? houseClause(f) : 'of common birth';
  const s1 = `${f.given}, ${lineage} — a ${f.profession} of ${placeClause(f)}.`;

  // 2) FORMATION — the era that shaped them, and the bent it left.
  const grew = rng.pick(['came of age', 'grew up', 'came up']);
  const era = eraPhrase(f);
  const lessons = f.dominantValue ? VALUE_LESSON[f.dominantValue] : undefined;
  const lesson = lessons ? rng.pick(lessons) : undefined;
  let s2 = '';
  if (era && lesson) s2 = `${f.orphaned ? 'Orphaned young, they' : 'They'} ${grew} ${era}, and ${lesson}.`;
  else if (era) s2 = `${f.orphaned ? 'Orphaned young, they' : 'They'} ${grew} ${era}.`;
  else if (lesson) s2 = `${f.orphaned ? 'Orphaned young, they' : 'They'} ${lesson}.`;
  else if (f.orphaned) s2 = 'Orphaned young, they made their own way.';

  return (s1 + (s2 ? ' ' + cap(s2) : '')).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------- the player's voice -----
// Every second-person line the player-view builders speak — story verbs, tensions,
// threats, cast statuses, beliefs, goal diagnosis. The ENGINE decides WHEN a line
// fires (thresholds, bands, priorities — all deterministic); the PACK decides how
// it READS. A sci-fi universe rewrites this table and "You wed" becomes whatever
// its people say instead. Typed by the explicit interface below (not inferred), so
// other packs may supply different words without fighting literal string types.

/** A phrase wrapped around the other party's (link-rendered) name in a story beat. */
export interface AroundName {
  pre: string;
  post: string;
}

/** The full second-person vocabulary of the player view. */
export interface PlayerVoice {
  /** MY STORY — first-person milestones of the player's life. */
  story: {
    /** annotation on a loss the player witnessed first-hand */
    witnessed: string;
    /** annotation on a loss learned from travelling news, `days` after the fact */
    newsDelay: (days: number) => string;
    /** relationship milestones — the phrase wraps the other's linked name */
    bond: {
      spouse: AroundName; // a marriage
      feud: AroundName; // an open feud
      rival: AroundName; // a declared rivalry
      friend: AroundName; // a declared friendship
      fond: AroundName; // strong warmth, no flag yet
      resent: AroundName; // strong dislike, no flag yet
    };
  };
  /** WHAT'S HAPPENING — live, unresolved threads. */
  tension: {
    warming: (name: string) => string;
    souring: (name: string) => string;
    /** news on the road; `from` is undefined when the source place is unknown */
    awaitingNews: (from: string | undefined, days: number) => string;
  };
  /** OPPORTUNITIES — openings the world is presenting. */
  opportunity: {
    court: (name: string) => string;
    befriend: (name: string) => string;
  };
  /** THREATS — narrative worries. */
  threat: {
    grudge: (name: string) => string;
    needLow: (need: string) => string;
    /** the player's home divided; `place` is undefined when it has no name */
    divided: (place: string | undefined) => string;
    aging: string;
  };
  /** PEOPLE WHO MATTER — one-line statuses that make a name read as a character. */
  cast: {
    /** your feeling toward someone, as a word — five bands, warmest first
     *  (same banding pattern as NEED_FEELS; the engine picks the band) */
    moodWords: [string, string, string, string, string];
    spouseNote: string;
    courtingNote: string;
    courtingWarming: string;
    courtingCold: string;
    allyNote: string;
    allySteadfast: string;
    rivalNote: string;
    rivalHostile: string;
    rivalCold: string;
    rulerNote: string;
    rulerLongReigning: string;
    rulerNewlyRisen: string;
    rulerSeated: string;
  };
  /** ATTENTION VERBS — the obvious response, put on the notification itself. */
  attention: {
    confront: string; // a rival's line → provoke
    spendTime: string; // a spouse's/ally's line → socialize
    court: string; // the one you hope to wed → court
  };
  /** THE LINE — death as a transition (the Dynasty step of the gameplay loop). */
  succession: {
    /** who the heir was to the one who died — shown beside their name in the handoff */
    relation: { child: string; spouse: string; sibling: string };
    /** the heir stands ready; wraps their linked name */
    continues: AroundName;
    /** the heir lives elsewhere — following the line will move your attention there */
    away: (place: string) => string;
    /** no living kin remains — the story truly ends here */
    lineEnds: string;
  };
  /** WHAT YOU BELIEVE — the player's subjective reality, stated as their own truth. */
  belief: {
    /** who rules the player's home; `place` is undefined when it has no name */
    rules: (ruler: string, place: string | undefined) => string;
    isDead: (name: string) => string;
    /** subjective absence — news still on the road from `from` (undefined = unknown) */
    noWord: (from: string | undefined) => string;
  };
  /** GOAL AS DIAGNOSIS — obstacle, next step, narrator readings. */
  goal: {
    nextStep: {
      court: (name: string) => string;
      socializeTarget: (name: string) => string;
      socialize: string;
      work: string;
      rule: string;
    };
    rule: {
      /** narrator reading of your renown — three bands, obscure first */
      readings: [string, string, string];
      /** the reading plus the person in the way (holder undefined = open seat) */
      obstacle: (reading: string, holder: string | undefined) => string;
    };
    wed: {
      noTarget: string;
      scarcelyKnown: (name: string) => string;
      growingCloser: (name: string) => string;
      nearlyWon: (name: string) => string;
    };
    reconcile: (name: string) => string;
    family: string;
    belonging: string;
  };
}

export const PLAYER_VOICE: PlayerVoice = {
  story: {
    witnessed: 'you were there',
    newsDelay: (days) => `word reached you ${days} day${days === 1 ? '' : 's'} later`,
    bond: {
      spouse: { pre: 'You wed ', post: '.' },
      feud: { pre: 'You came to hate ', post: '.' },
      rival: { pre: 'You fell out with ', post: '.' },
      friend: { pre: 'You befriended ', post: '.' },
      fond: { pre: 'You grew fond of ', post: '.' },
      resent: { pre: 'You came to resent ', post: '.' },
    },
  },
  tension: {
    warming: (name) => `${name} seems to be warming to you.`,
    souring: (name) => `${name}'s ill feeling toward you is growing.`,
    awaitingNews: (from, days) => {
      const when = days <= 7 ? 'any day now' : days <= 30 ? 'within the month' : 'before long';
      return `You're waiting on news from ${from ?? 'afar'} — it should reach you ${when}.`;
    },
  },
  opportunity: {
    court: (name) => `You could court ${name}.`,
    befriend: (name) => `${name} could become a true friend.`,
  },
  threat: {
    grudge: (name) => `${name} bears you a grudge.`,
    needLow: (need) => `Your ${need} is running dangerously low.`,
    divided: (place) => `${place ?? 'Your town'} is divided against itself.`,
    aging: 'Your years are catching up with you.',
  },
  cast: {
    moodWords: ['devoted', 'content', 'growing distant', 'strained', 'bitter'],
    spouseNote: 'your spouse',
    courtingNote: 'you hope to wed',
    courtingWarming: 'warming to you',
    courtingCold: 'not yet won',
    allyNote: 'stands with you',
    allySteadfast: 'a steadfast friend',
    rivalNote: 'wishes you ill',
    rivalHostile: 'openly hostile',
    rivalCold: 'no love lost',
    rulerNote: 'rules over you',
    rulerLongReigning: 'long-reigning',
    rulerNewlyRisen: 'newly risen',
    rulerSeated: 'on the throne',
  },
  attention: {
    confront: 'Confront',
    spendTime: 'Spend time',
    court: 'Press your suit',
  },
  succession: {
    relation: { child: 'your eldest child', spouse: 'your widowed spouse', sibling: 'your closest sibling' },
    continues: { pre: 'The line continues: ', post: ' stands ready to take it up.' },
    away: (place) => `They live in ${place} — your attention will follow the line there.`,
    lineEnds: 'No kin survives you. The line ends here — the world goes on without it.',
  },
  belief: {
    rules: (ruler, place) => `${ruler} rules ${place ?? 'your home'}.`,
    isDead: (name) => `${name} is dead.`,
    noWord: (from) => `No word has reached you from ${from ?? 'afar'}.`,
  },
  goal: {
    nextStep: {
      court: (name) => `Court ${name} — win their heart.`,
      socializeTarget: (name) => `Spend time with ${name}.`,
      socialize: 'Seek out others and make yourself known.',
      work: 'Work at your trade — it builds your name.',
      rule: 'Raise your standing — a village follows the renowned.',
    },
    rule: {
      readings: [
        'Few beyond your own door know your name.',
        'People know your name, but it has not spread far enough.',
        'Your name carries real weight now — the seat is nearly within reach.',
      ],
      obstacle: (reading, holder) => (holder ? `${reading} ${holder} still holds the seat.` : reading),
    },
    wed: {
      noTarget: 'There is no one you have set your heart on yet.',
      scarcelyKnown: (name) => `${name} scarcely knows you yet.`,
      growingCloser: (name) => `You and ${name} are growing closer, but it is not yet love.`,
      nearlyWon: (name) => `${name}'s heart is nearly yours.`,
    },
    reconcile: (name) => `The bad blood with ${name} still festers.`,
    family: 'You have no children yet.',
    belonging: 'You feel apart from those around you.',
  },
};
