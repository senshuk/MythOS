/**
 * Shared presentation helpers used across the UI panels: event tone classes,
 * the clickable-prose renderer, keyboard activation, persisted view prefs, and
 * the pack's culture colours. No component here owns state that matters.
 */
import { useRef, useState } from 'react';
import type { EventPart, EventRef } from '../engine/model';
import { CULTURES } from '../engine/pack';
import { usePeek } from './peek';

export const TYPE_TONE: Record<string, string> = {
  born: 'good',
  married: 'good',
  friendship: 'good',
  kindness: 'good',
  prosperity: 'good',
  milestone: 'good',
  trade: 'good',
  boon: 'good',
  wonder: 'good',
  omen: 'focus',
  raid: 'bad',
  blight: 'bad',
  plague: 'bad',
  ruined: 'bad',
  battle: 'bad',
  conquest: 'bad',
  beast: 'bad',
  died: 'neutral',
  widowed: 'neutral',
  settlement_founded: 'neutral',
  figure_passed: 'neutral',
  ascension: 'neutral',
  dynasty: 'focus',
  house_fallen: 'bad',
  ruler_died: 'neutral',
  focus_shift: 'focus',
  emigrated: 'focus',
  immigrated: 'focus',
  goal_met: 'good',
  rivalry: 'bad',
  dispute: 'bad',
  feud: 'bad',
  brawl: 'bad',
  died_brawl: 'bad',
  hardship: 'bad',
  famine: 'bad',
};

/** Keyboard activation for non-button elements that carry role="button" (these wrap
 *  clickable entity-links, so they cannot be real <button>s). Fires on Enter/Space. */
export function onActivate(e: import('react').KeyboardEvent, run: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
}

/** useState that survives a reload — for UI PREFERENCES only (dismissed banners, chosen
 *  feed view). Kept out of the save file: these are view choices, not world state. */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T | ((p: T) => T)) =>
    setVal((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable — fall back to in-memory only */
      }
      return next;
    });
  return [val, set];
}

// culture names & colours come from the PACK (a universe knows its factions' banners) —
// read through the engine's pack boundary, so a different universe recolours the map for free.
export const cultureColor = (id: string) => CULTURES.find((c) => c.id === id)?.color ?? '#8a8f9e';
export const cultureName = (id: string) => CULTURES.find((c) => c.id === id)?.name ?? id;

/** Keep a list VISUALLY STILL across re-ranks: items keep the relative order they first
 *  appeared in for as long as they survive; newcomers append at the tail. While time
 *  streams (a snapshot a second), a roster that re-sorts every tick reads as churn —
 *  the CONTENT should change under the player's eyes, not the furniture. */
export function useStableOrder<T>(items: T[], keyOf: (item: T) => string | number): T[] {
  const order = useRef<(string | number)[]>([]);
  const byKey = new Map(items.map((it) => [keyOf(it), it]));
  // retain survivors in their remembered order, then append the newly arrived
  const kept = order.current.filter((k) => byKey.has(k));
  for (const it of items) {
    const k = keyOf(it);
    if (!kept.includes(k)) kept.push(k);
  }
  order.current = kept;
  return kept.map((k) => byKey.get(k)!);
}

/** Renders an event's prose with its named settlements & people as clickable links.
 *  Hovering a name floats a peek card (via the PeekLayer); clicking inspects. */
export function EventText({ parts, onRef }: { parts: EventPart[]; onRef: (ref: EventRef) => void }) {
  const peek = usePeek();
  return (
    <>
      {parts.map((p, i) =>
        p.ref ? (
          <button
            key={i}
            className={`ent ent-${p.ref.kind}`}
            onClick={(e) => {
              e.stopPropagation();
              peek.hide();
              onRef(p.ref!);
            }}
            onMouseEnter={(e) => peek.show(p.ref!, e)}
            onMouseLeave={peek.hide}
          >
            {p.text}
          </button>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
