/**
 * Renders structured WorldEvents into prose ON DEMAND. History is stored as
 * structured data (model.ts); text is produced here when building a snapshot.
 * This keeps the canonical log queryable and dodges Warsim's "prose-in-save"
 * delimiter problems.
 */
import { type World, type WorldEvent } from './model';
import { fullName } from './world';

export function renderEvent(world: World, ev: WorldEvent): string {
  const n = (i: number) => (ev.subjects[i] !== undefined ? fullName(world, ev.subjects[i]) : '?');
  const age = ev.data.age;

  const d = ev.data;

  switch (ev.type) {
    case 'settlement_founded':
      return ev.subjects.length
        ? `${d.name} was founded by ${n(0)} with ${d.population} souls.`
        : `The settlement of ${d.name} was founded with ${d.population} souls.`;
    case 'ascension':
      return `${n(0)} became ruler of ${d.settlement}.`;
    case 'ruler_died':
      return `${n(0)}, ruler of ${d.settlement}, passed away.`;
    case 'prosperity':
      return `${d.name} enjoyed a prosperous year (now ${d.population} souls).`;
    case 'hardship':
      return `${d.name} suffered hardship — ${d.toll} souls lost.`;
    case 'milestone':
      return `${d.name} grew to ${d.population} souls.`;
    case 'figure_passed':
      return `${d.name}, long remembered in ${d.settlement}, passed away at ${d.age}.`;
    case 'boon':
      return `${d.kind} blessed ${d.name}.`;
    case 'blight':
      return `A hard season struck ${d.name} — ${d.toll} lost.`;
    case 'plague':
      return `Plague swept ${d.name} — ${d.toll} perished.`;
    case 'ruined':
      return ev.subjects.length
        ? `${d.name} fell to ruin under ${n(0)}, its last ruler.`
        : `${d.name} was abandoned, falling to ruin.`;
    case 'battle':
      return `${d.a} and ${d.b} clashed in battle (${d.aToll} and ${d.bToll} fell).`;
    case 'conquest':
      return ev.subjects.length
        ? `${n(0)} of ${d.victor} conquered ${d.fallen}, razing it.`
        : `${d.victor} conquered ${d.fallen}, razing it.`;
    case 'wonder':
      return `${d.wonder} was raised in ${d.name}.`;
    case 'beast':
      return `${d.beast} ravaged ${d.name} — ${d.toll} slain.`;
    case 'omen':
      return `Over ${d.name}, ${d.omen} — folk feared dark days.`;
    case 'trade':
      return `Caravans (${d.goods} in goods) ran between ${d.from} and ${d.to}.`;
    case 'raid':
      return `${d.raider} raided ${d.victim}${d.toll ? ` (${d.toll} lost)` : ''}.`;
    case 'famine':
      return `Famine struck ${d.name} — ${d.toll} starved.`;
    case 'focus_shift':
      return `Attention turned from ${d.from} to ${d.to}.`;
    case 'emigrated':
      return `${n(0)} left ${d.from} to settle in ${d.to}.`;
    case 'immigrated':
      return `${n(0)} arrived in ${d.to} from ${d.from}.`;
    case 'born':
      return `${n(0)} was born to ${n(1)} and ${n(2)}.`;
    case 'died':
      return `${n(0)} passed away${age !== undefined ? `, aged ${age}` : ''}${d.settlement ? ` in ${d.settlement}` : ''}.`;
    case 'died_brawl':
      return `${n(0)} was killed by ${n(1)} in a brawl.`;
    case 'married':
      return `${n(0)} and ${n(1)} were married.`;
    case 'widowed':
      return `${n(0)} was widowed.`;
    case 'friendship':
      return `${n(0)} and ${n(1)} became close friends.`;
    case 'rivalry':
      return `${n(0)} and ${n(1)} became rivals.`;
    case 'feud':
      return `A bitter feud broke out between ${n(0)} and ${n(1)}.`;
    case 'dispute':
      return `${n(0)} and ${n(1)} quarrelled.`;
    case 'kindness':
      return `${n(0)} did ${n(1)} a kindness.`;
    case 'brawl':
      return `${n(0)} and ${n(1)} came to blows.`;
    case 'goal_met': {
      const who = n(0);
      switch (d.goal) {
        case 'wed':
          return `${who} found love at last and married.`;
        case 'family':
          return `${who} became a parent — a lifelong wish fulfilled.`;
        case 'reconcile':
          return `${who} made peace with an old enemy.`;
        case 'rule':
          return `${who} rose to lead the settlement.`;
        default:
          return `${who} fulfilled a cherished goal.`;
      }
    }
    default:
      return ev.type;
  }
}
