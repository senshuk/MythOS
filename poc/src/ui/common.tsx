/**
 * Shared presentation helpers used across the UI panels: event tone classes,
 * the clickable-prose renderer, keyboard activation, persisted view prefs, and
 * the pack's culture colours. No component here owns state that matters.
 */
import { useState } from 'react';
import type { EventPart, EventRef } from '../engine/model';
import { CULTURES } from '../engine/pack';

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

/** Renders an event's prose with its named settlements & people as clickable links. */
export function EventText({ parts, onRef }: { parts: EventPart[]; onRef: (ref: EventRef) => void }) {
  return (
    <>
      {parts.map((p, i) =>
        p.ref ? (
          <button
            key={i}
            className={`ent ent-${p.ref.kind}`}
            onClick={(e) => {
              e.stopPropagation();
              onRef(p.ref!);
            }}
            title={`inspect this ${p.ref.kind}`}
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
