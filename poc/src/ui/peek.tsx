/**
 * Hover peeks — the CK-style "every noun answers a glance" layer. Hovering any
 * entity link asks the worker for a tiny PeekCard and floats it by the cursor;
 * clicking still commits to a full inspection. One layer serves the whole app via
 * context, so panels never carry tooltip plumbing of their own.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EventRef, PeekCard } from '../engine/model';
import { HouseShield } from './heraldry';

interface PeekApi {
  show: (ref: EventRef, at: { clientX: number; clientY: number }) => void;
  hide: () => void;
}

const PeekContext = createContext<PeekApi | null>(null);

/** Panels ask for this to wire hover handlers; null (no provider) degrades to no-op. */
export function usePeek(): PeekApi {
  return useContext(PeekContext) ?? { show: () => {}, hide: () => {} };
}

const HOVER_DELAY_MS = 260; // long enough that scanning a list doesn't strobe cards
const CARD_W = 264; // must track .peek-card width for edge clamping

export function PeekLayer({
  peek,
  children,
}: {
  peek: (ref: EventRef) => Promise<PeekCard | null>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<{ card: PeekCard; x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0); // stale-guard: only the latest hover may open a card

  const show = useCallback(
    (ref: EventRef, at: { clientX: number; clientY: number }) => {
      const { clientX, clientY } = at;
      window.clearTimeout(timer.current);
      const mySeq = ++seq.current;
      timer.current = window.setTimeout(() => {
        void peek(ref).then((card) => {
          if (card && seq.current === mySeq) {
            const x = Math.min(clientX + 14, window.innerWidth - CARD_W - 10);
            const y = Math.min(clientY + 18, window.innerHeight - 120);
            setOpen({ card, x, y });
          }
        });
      }, HOVER_DELAY_MS);
    },
    [peek],
  );

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    seq.current++;
    setOpen(null);
  }, []);
  useEffect(() => hide, [hide]);

  return (
    <PeekContext.Provider value={{ show, hide }}>
      {children}
      {open && (
        <div className={`peek-card${open.card.dead ? ' peek-dead' : ''}`} style={{ left: open.x, top: open.y }}>
          {open.card.houseId !== undefined && (
            <HouseShield id={open.card.houseId} name={open.card.houseName ?? ''} size={26} className="peek-shield" />
          )}
          <div className="peek-body">
            <strong className="peek-name">{open.card.name}</strong>
            {open.card.lines.map((l, i) => (
              <span key={i} className="peek-line">{l}</span>
            ))}
          </div>
        </div>
      )}
    </PeekContext.Provider>
  );
}
