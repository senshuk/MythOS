/**
 * The UI's icon language: a single line-art SVG set (stroke = currentColor) so every
 * glyph renders identically on every platform — replacing the emoji the panels used
 * to lean on. The engine still emits compact glyph strings ('⚔', '💍'…) in views;
 * `Glyph` translates any known glyph to its drawn icon and falls back to the raw
 * text for anything unmapped, so packs can invent icons without breaking the UI.
 */
import type { ReactNode } from 'react';

/** Every drawn icon, as 24×24 line art. Stroke-only, inheriting currentColor. */
const PATHS: Record<string, ReactNode> = {
  heart: <path d="M12 20 C7 15.5 4 12.5 4 9.4 C4 7 5.9 5 8.2 5 C9.8 5 11.2 5.9 12 7.3 C12.8 5.9 14.2 5 15.8 5 C18.1 5 20 7 20 9.4 C20 12.5 17 15.5 12 20 Z" />,
  spark: (
    <>
      <path d="M8 4 L10 10 L4 8" />
      <path d="M16 20 L14 14 L20 16" />
      <line x1="13.5" y1="6" x2="17.5" y2="4.5" />
      <line x1="6.5" y1="17.5" x2="10.5" y2="19" />
    </>
  ),
  letter: (
    <>
      <rect x="3.5" y="6" width="17" height="12.5" rx="1.6" />
      <path d="M4.5 7.5 L12 13 L19.5 7.5" />
    </>
  ),
  ring: (
    <>
      <circle cx="12" cy="14" r="5.4" />
      <path d="M9.6 6.2 L12 3.4 L14.4 6.2 L12 8.7 Z" />
    </>
  ),
  hands: (
    <>
      <path d="M3.5 12.5 L8 8.5 C9 7.7 10.3 7.8 11.2 8.5 L13 10" />
      <path d="M20.5 12.5 L16 8.5 C15 7.7 13.7 7.8 12.8 8.5 L10.5 10.5 C9.9 11.1 10 12 10.6 12.5 C11.2 13 12 13 12.6 12.5 L13.6 11.6" />
      <path d="M13.6 11.6 L17 15 M11.5 13.5 L14.5 16.5 M9.5 14.5 L12 17" />
    </>
  ),
  swords: (
    <>
      <path d="M5 4 L15.5 14.5 M5 4 L5 7.5 M5 4 L8.5 4" />
      <path d="M19 4 L8.5 14.5 M19 4 L19 7.5 M19 4 L15.5 4" />
      <path d="M6.5 16.5 L9.5 19.5 M17.5 16.5 L14.5 19.5 M7 20 L10 17 M17 20 L14 17" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 L21 19.5 L3 19.5 Z" />
      <line x1="12" y1="10" x2="12" y2="14.5" />
      <circle cx="12" cy="17" r="0.4" fill="currentColor" />
    </>
  ),
  hourglass: (
    <>
      <path d="M7 3.5 H17 M7 20.5 H17" />
      <path d="M8 3.5 C8 9 12 10 12 12 C12 14 8 15 8 20.5 M16 3.5 C16 9 12 10 12 12 C12 14 16 15 16 20.5" />
    </>
  ),
  crown: (
    <>
      <path d="M4.5 17.5 L4 8.5 L8.5 12 L12 6.5 L15.5 12 L20 8.5 L19.5 17.5 Z" />
      <line x1="4.7" y1="15" x2="19.3" y2="15" />
    </>
  ),
  tomb: (
    <>
      <path d="M6.5 20 V9.5 C6.5 6.4 8.9 4 12 4 C15.1 4 17.5 6.4 17.5 9.5 V20" />
      <line x1="4.5" y1="20" x2="19.5" y2="20" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <line x1="9.8" y1="11" x2="14.2" y2="11" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="5.5" cy="12" r="0.8" fill="currentColor" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
      <circle cx="18.5" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
  child: (
    <>
      <circle cx="12" cy="7.5" r="3" />
      <path d="M7 20 C7 16.5 9.2 14.5 12 14.5 C14.8 14.5 17 16.5 17 20" />
    </>
  ),
  check: <path d="M5 12.5 L10 17.5 L19 6.5" />,
  heartDark: (
    <>
      <path d="M12 20 C7 15.5 4 12.5 4 9.4 C4 7 5.9 5 8.2 5 C9.8 5 11.2 5.9 12 7.3 C12.8 5.9 14.2 5 15.8 5 C18.1 5 20 7 20 9.4 C20 12.5 17 15.5 12 20 Z" />
      <line x1="8" y1="9" x2="16" y2="13" />
    </>
  ),
  door: (
    <>
      <path d="M6 20 V5 C6 4.2 6.7 3.5 7.5 3.5 H16.5 C17.3 3.5 18 4.2 18 5 V20" />
      <line x1="4" y1="20" x2="20" y2="20" />
      <circle cx="15" cy="12" r="0.6" fill="currentColor" />
      <path d="M14 20 V7 L18 5 V20" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />,
  flag: (
    <>
      <line x1="6" y1="3.5" x2="6" y2="20.5" />
      <path d="M6 4.5 C9 3 11 6 14 4.5 C16 3.5 17.5 4 18 4.5 V12 C17.5 11.5 16 11 14 12 C11 13.5 9 10.5 6 12" />
    </>
  ),
  focus: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  eye: (
    <>
      <path d="M3 12 C5.5 7.5 8.5 5.5 12 5.5 C15.5 5.5 18.5 7.5 21 12 C18.5 16.5 15.5 18.5 12 18.5 C8.5 18.5 5.5 16.5 3 12 Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  quill: (
    <>
      <path d="M19.5 4.5 C14 5 9.5 8.5 7.5 14 L6 19.5 L11 17.5 C15.5 15.5 19 10.5 19.5 4.5 Z" />
      <line x1="7.5" y1="14" x2="13" y2="10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="20" y1="20" x2="15.6" y2="15.6" />
    </>
  ),
  back: <path d="M14.5 5.5 L8 12 L14.5 18.5" />,
  forward: <path d="M9.5 5.5 L16 12 L9.5 18.5" />,
  chevronL: <path d="M14.5 5.5 L8 12 L14.5 18.5" />,
  chevronR: <path d="M9.5 5.5 L16 12 L9.5 18.5" />,
  play: <path d="M8 5.5 L18 12 L8 18.5 Z" />,
  pause: (
    <>
      <line x1="9" y1="6" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="18" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  trophy: (
    <>
      <path d="M8 4 H16 V9 C16 11.8 14.2 14 12 14 C9.8 14 8 11.8 8 9 Z" />
      <path d="M8 5.5 H4.5 C4.5 8.5 6 10.5 8 10.8 M16 5.5 H19.5 C19.5 8.5 18 10.5 16 10.8" />
      <path d="M12 14 V17 M9 20 H15 M10 17 H14 L15 20 H9 Z" />
    </>
  ),
};

/** A drawn icon by name. Sized in em so it rides the text it sits beside. */
export function Icon({ name, size = 1.05, className }: { name: string; size?: number; className?: string }) {
  const body = PATHS[name];
  if (!body) return null;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      width={`${size}em`}
      height={`${size}em`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  );
}

/** Engine views carry compact glyph strings; translate the known ones to drawn icons. */
const GLYPH_ICON: Record<string, string> = {
  '💞': 'heart',
  '💢': 'spark',
  '📨': 'letter',
  '💍': 'ring',
  '🤝': 'hands',
  '⚔': 'swords',
  '⚠': 'warning',
  '⏳': 'hourglass',
  '👑': 'crown',
  '⚰': 'tomb',
  '…': 'ellipsis',
  '👶': 'child',
  '✓': 'check',
  '🖤': 'heartDark',
  '🚪': 'door',
  '•': 'dot',
  '⚑': 'flag',
  '◉': 'focus',
  '💑': 'heart',
  '💔': 'heartDark',
  '🏠': 'door',
  '👁': 'eye',
};

/** Render an engine-emitted glyph as its drawn icon, falling back to the raw text. */
export function Glyph({ glyph, size }: { glyph: string; size?: number }) {
  const name = GLYPH_ICON[glyph];
  return name ? <Icon name={name} size={size} /> : <span aria-hidden="true">{glyph}</span>;
}

/** The event-type icons for story beats (used to be emoji in STORY_ICON). */
export const TONE_ICON: Record<string, string> = {
  married: 'ring',
  friendship: 'hands',
  feud: 'swords',
  rivalry: 'swords',
  brawl: 'swords',
  born: 'child',
  died: 'tomb',
  widowed: 'heartDark',
  ascension: 'crown',
  dynasty: 'crown',
  goal_met: 'check',
  exile: 'door',
};
