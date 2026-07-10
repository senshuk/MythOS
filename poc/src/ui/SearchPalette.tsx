/**
 * The quick-find palette (Ctrl/Cmd-K): one search over everything the snapshot
 * names — places, Houses, figures of history, notable folk, cultures — so a
 * 10,000-soul world is navigable by name, not by scrolling. Selecting an entry
 * inspects it through the ordinary navigation path.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventRef, Snapshot } from '../engine/model';
import { cultureName } from './common';
import { HouseShield } from './heraldry';
import { Icon } from './icons';

interface Entry {
  label: string;
  sub: string;
  ref: EventRef;
  group: string;
  houseId?: number; // draws arms beside House entries
  dim?: boolean; // ruins, the fallen, the dead
}

function buildIndex(stat: Snapshot): Entry[] {
  const entries: Entry[] = [];
  for (const s of stat.settlements) {
    entries.push({
      label: s.name,
      sub: s.ruinedYear !== undefined ? `ruin · fell y${s.ruinedYear}` : `${s.population.toLocaleString()} souls · ${s.culture}`,
      ref: { kind: 'settlement', id: s.id },
      group: 'Places',
      dim: s.ruinedYear !== undefined,
    });
  }
  for (const h of stat.houses) {
    entries.push({
      label: `House ${h.name}`,
      sub: h.extinctYear !== undefined ? `fallen y${h.extinctYear}` : h.seat ? `rules ${h.seat}` : 'out of power',
      ref: { kind: 'house', id: h.id },
      group: 'Houses',
      houseId: h.id,
      dim: h.extinctYear !== undefined,
    });
  }
  for (const f of stat.historicalFigures) {
    entries.push({
      label: f.name,
      sub: `${f.role} of ${f.settlement}`,
      ref: { kind: 'figure', id: f.id },
      group: 'Figures',
      dim: f.deathYear !== undefined,
    });
  }
  for (const a of stat.notable) {
    entries.push({
      label: a.name,
      sub: `${a.species} ${a.profession} · ${a.ageYears}y`,
      ref: { kind: 'actor', id: a.id },
      group: 'Folk',
    });
  }
  for (const id of new Set(stat.map.nodes.map((n) => n.cultureId))) {
    entries.push({ label: cultureName(id), sub: 'a people & creed', ref: { kind: 'culture', id }, group: 'Peoples' });
  }
  return entries;
}

export function SearchPalette({
  stat,
  open,
  onClose,
  onGo,
}: {
  stat: Snapshot;
  open: boolean;
  onClose: () => void;
  onGo: (ref: EventRef) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useMemo(() => buildIndex(stat), [stat]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return index.slice(0, 10);
    // name matches first (position of the hit), then meta matches
    const scored: { e: Entry; score: number }[] = [];
    for (const e of index) {
      const inLabel = e.label.toLowerCase().indexOf(needle);
      const inSub = e.sub.toLowerCase().indexOf(needle);
      if (inLabel >= 0) scored.push({ e, score: inLabel });
      else if (inSub >= 0) scored.push({ e, score: 100 + inSub });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 12).map((s) => s.e);
  }, [q, index]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      // focus after the overlay paints
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setSel(0), [q]);

  if (!open) return null;

  const go = (e: Entry) => {
    onGo(e.ref);
    onClose();
  };

  return (
    <div className="palette-veil" onClick={onClose}>
      <div className="palette" role="dialog" aria-label="find anything" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={q}
            placeholder="Find a place, House, figure, soul, people…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter' && results[sel]) go(results[sel]);
            }}
          />
          <kbd>esc</kbd>
        </div>
        {results.length === 0 ? (
          <p className="palette-empty muted">Nothing in this world answers to “{q}”.</p>
        ) : (
          <ul className="palette-results">
            {results.map((e, i) => (
              <li key={`${e.ref.kind}:${e.ref.id}`}>
                <button
                  className={`palette-row${i === sel ? ' sel' : ''}${e.dim ? ' dim' : ''}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(e)}
                >
                  {e.houseId !== undefined ? (
                    <HouseShield id={e.houseId} name={e.label} size={18} />
                  ) : (
                    <span className={`palette-kind pk-${e.ref.kind}`} aria-hidden="true" />
                  )}
                  <span className="palette-label">{e.label}</span>
                  <span className="palette-sub muted">{e.sub}</span>
                  <span className="palette-group">{e.group}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
