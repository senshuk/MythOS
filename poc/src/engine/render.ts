/**
 * Renders structured WorldEvents into prose ON DEMAND. History is stored as
 * structured data (model.ts); text is produced here when building a snapshot — which
 * keeps the canonical log queryable and dodges Warsim's "prose-in-save" problems.
 *
 * The MECHANISM is here (resolve subject names, look up the template, apply it); the
 * actual prose templates are PACK DATA (`content/narrative.ts`). The engine therefore
 * carries no universe-specific wording — a different pack reads completely differently,
 * and a pack may even render event types the engine has never heard of. Unknown types
 * fall back to their raw type string.
 */
import { type World, type WorldEvent } from './model';
import { fullName } from './world';
import { EVENT_RENDER } from '../content/narrative';

export function renderEvent(world: World, ev: WorldEvent): string {
  const n = (i: number) => (ev.subjects[i] !== undefined ? fullName(world, ev.subjects[i]) : '?');
  const template = EVENT_RENDER[ev.type];
  return template ? template(n, ev.data, ev.subjects.length) : ev.type;
}
