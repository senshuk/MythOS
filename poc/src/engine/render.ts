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
import { type World, type WorldEvent, type EventPart, type EventRef } from './model';
import { fullName } from './world';
import { EVENT_RENDER } from '../content/narrative';

export function renderEvent(world: World, ev: WorldEvent): string {
  const n = (i: number) => (ev.subjects[i] !== undefined ? fullName(world, ev.subjects[i]) : '?');
  const template = EVENT_RENDER[ev.type];
  return template ? template(n, ev.data, ev.subjects.length) : ev.type;
}

/**
 * Split an event's prose into parts, linkifying the entities it names so the UI can
 * make them clickable — every settlement and every person becomes traceable. A person
 * is an ACTOR if it's still a live entity (inspect its relationships), else a remembered
 * FIGURE (a record). Settlements are matched by name. Longest names claim first so a
 * person's name isn't split by a settlement substring.
 */
export function renderEventParts(world: World, ev: WorldEvent): EventPart[] {
  const text = renderEvent(world, ev);
  const tokens: { name: string; ref: EventRef }[] = [];
  for (const id of ev.subjects) {
    const isActor = world.identity.has(id);
    const name = isActor ? fullName(world, id) : world.names.get(id);
    if (name) tokens.push({ name, ref: isActor ? { kind: 'actor', id } : { kind: 'figure', id } });
  }
  for (const s of world.settlements) tokens.push({ name: s.name, ref: { kind: 'settlement', id: s.id } });
  tokens.sort((a, b) => b.name.length - a.name.length);

  // claim non-overlapping ranges, longest tokens first
  const claims: { start: number; end: number; ref: EventRef }[] = [];
  for (const t of tokens) {
    if (!t.name) continue;
    let from = 0;
    for (;;) {
      const i = text.indexOf(t.name, from);
      if (i < 0) break;
      const end = i + t.name.length;
      if (!claims.some((c) => i < c.end && end > c.start)) claims.push({ start: i, end, ref: t.ref });
      from = end;
    }
  }
  claims.sort((a, b) => a.start - b.start);

  const parts: EventPart[] = [];
  let cursor = 0;
  for (const c of claims) {
    if (c.start > cursor) parts.push({ text: text.slice(cursor, c.start) });
    parts.push({ text: text.slice(c.start, c.end), ref: c.ref });
    cursor = c.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
