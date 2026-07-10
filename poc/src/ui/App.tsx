/**
 * The "watch the village" UI. Three panels: a dashboard digest, a scrolling
 * history feed (click an event to trace WHY it happened), and an inspector that
 * shows an actor's relationships/life or an event's causal ancestry.
 *
 * The UI is intentionally a thin, read-only renderer of snapshots.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import type { PointerEvent as RPointerEvent, MouseEvent as RMouseEvent } from 'react';
import type { EventView, EventPart, EventRef, SettlementView, PlayerView, EraView, TaleView, FigureView, HouseView, TongueView, Tension, DecisionView, ActiveAmbitionView, AmbitionOffer } from '../engine/model';
import type { Intent } from '../engine/intent';
import { MAP_STYLES, type MapStyle } from '../content/mapstyles';
import { createSubstrate, SurfaceSubstrate, StarfieldSubstrate } from '../engine/substrate';
import { paintTerrain, paintStarfield, buildRoads, buildRivers, type TerrainLabel } from './terrain';
import { featureName, CULTURES } from '../engine/pack';
import { useSim } from './useSim';

const TYPE_TONE: Record<string, string> = {
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
function onActivate(e: import('react').KeyboardEvent, run: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
}

/** useState that survives a reload — for UI PREFERENCES only (dismissed banners, chosen
 *  feed view). Kept out of the save file: these are view choices, not world state. */
function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
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

// Presentation of a settlement's staple buffer. The label is deliberately pack-flavoured
// (a food pack reads "starving/fed"); the underlying number is the role-neutral
// subsistenceSecurity from the snapshot.
function subsistenceLabel(security: number): string {
  if (security < 0.5) return '⚠ starving';
  if (security < 1) return 'lean';
  if (security > 1.8) return 'plentiful';
  return 'fed';
}
function subsistenceClass(security: number): string {
  if (security < 0.5) return 'food-bad';
  if (security < 1) return 'food-warn';
  if (security > 1.8) return 'food-good';
  return 'muted';
}

// culture names & colours come from the PACK (a universe knows its factions' banners) —
// read through the engine's pack boundary, so a different universe recolours the map for free.
const cultureColor = (id: string) => CULTURES.find((c) => c.id === id)?.color ?? '#8a8f9e';
const cultureName = (id: string) => CULTURES.find((c) => c.id === id)?.name ?? id;

/** Renders an event's prose with its named settlements & people as clickable links. */
function EventText({ parts, onRef }: { parts: EventPart[]; onRef: (ref: EventRef) => void }) {
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

/** A framed choice with option buttons — shared by the world's decisions and an ambition's next
 *  step. Each option is an Intent taken through the normal player turn. */
function DecisionCard({ d, onAct, onRef, busy }: { d: DecisionView; onAct: (i: Intent) => void; onRef: (r: EventRef) => void; busy: boolean }) {
  return (
    <div className="decision-card">
      <p className="decision-prompt">
        <EventText parts={d.prompt} onRef={onRef} />
      </p>
      <div className="decision-options">
        {d.options.map((o, i) => (
          <button
            key={i}
            className={`decision-opt tone-${o.tone ?? 'neutral'}`}
            onClick={() => onAct(o.intent)}
            disabled={busy}
            title={o.hint}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The player's self-chosen through-line: the committed ambition with its live step (or closing
 *  outcome), and — when none is active or one has just resolved — the ambitions on offer. */
function AmbitionBanner({
  ambition,
  offered,
  onAct,
  onRef,
  onChoose,
  onAbandon,
  busy,
}: {
  ambition?: ActiveAmbitionView;
  offered: AmbitionOffer[];
  onAct: (i: Intent) => void;
  onRef: (r: EventRef) => void;
  onChoose: (id: string, target?: number) => void;
  onAbandon: () => void;
  busy: boolean;
}) {
  const resolved = ambition?.outcome !== undefined;
  return (
    <div className="ambition">
      {ambition && (
        <div className={`ambition-active${resolved ? ` amb-${ambition.outcome}` : ''}`}>
          <div className="ambition-head">
            <span className="amb-tag">⚑ Ambition</span>
            <span className="amb-label">{ambition.label}</span>
            {!resolved && (
              <button className="link amb-abandon" onClick={onAbandon} disabled={busy} title="let this ambition go">
                give up
              </button>
            )}
          </div>
          {resolved ? (
            <p className="amb-outcome">
              {ambition.outcome === 'fulfilled' ? '✓ You achieved it.' : '✗ It slipped beyond your reach.'} {ambition.note}
            </p>
          ) : (
            <>
              <p className="amb-note muted">{ambition.note}</p>
              {ambition.step && <DecisionCard d={ambition.step} onAct={onAct} onRef={onRef} busy={busy} />}
            </>
          )}
        </div>
      )}
      {offered.length > 0 && (
        <div className="ambition-choose">
          <span className="amb-tag">⚑ {ambition ? 'Set your next ambition' : 'What will you make of this life?'}</span>
          <div className="amb-offers">
            {offered.map((o) => (
              <button key={o.id} className="amb-offer" onClick={() => onChoose(o.id, o.target)} disabled={busy} title={o.hint}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// the mobile bottom-nav tabs — crisp line-art icons (currentColor) over a short label.
const NAV_TABS = [
  {
    id: 'world' as const,
    label: 'World',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
      </svg>
    ),
  },
  {
    id: 'chronicle' as const,
    label: 'Chronicle',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 6.4C10.2 5.2 8 4.6 5.5 4.6c-.8 0-1.5.6-1.5 1.4v11c0 .8.7 1.4 1.5 1.4 2.5 0 4.7.6 6.5 1.8" />
        <path d="M12 6.4C13.8 5.2 16 4.6 18.5 4.6c.8 0 1.5.6 1.5 1.4v11c0 .8-.7 1.4-1.5 1.4-2.5 0-4.7.6-6.5 1.8" />
        <line x1="12" y1="6.4" x2="12" y2="20.2" />
      </svg>
    ),
  },
  {
    id: 'inspector' as const,
    label: 'Inspect',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <line x1="20" y1="20" x2="15.6" y2="15.6" />
      </svg>
    ),
  },
];

export default function App() {
  const sim = useSim(123456);
  const [seedInput, setSeedInput] = useState('123456');
  const [historyYears, setHistoryYears] = useState(200);
  const [saveName, setSaveName] = useState('quicksave');
  const [tab, setTab] = useState<'world' | 'chronicle' | 'inspector'>('world');
  const [menuOpen, setMenuOpen] = useState(false);
  const [onboardDismissed, setOnboardDismissed] = usePersistentState('mythos.onboardDismissed', false);

  const stat = sim.snapshot;
  // tapping an event/villager/place jumps to the Inspector tab on mobile (harmless on desktop)
  const inspectActor = (id: number) => { sim.inspectActor(id); setTab('inspector'); };
  const inspectEvent = (id: number) => { sim.inspectEvent(id); setTab('inspector'); };
  const inspectRef = (ref: EventRef) => { sim.inspectRef(ref); setTab('inspector'); };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Myth<span className="dot">OS</span></span>
          {stat && <span className="village">{stat.settlementName}</span>}
        </div>
        <button className="menu-toggle" onClick={() => setMenuOpen((o) => !o)} aria-label="world menu" aria-expanded={menuOpen}>
          ☰
        </button>
        <div className={`controls ${menuOpen ? 'open' : ''}`}>
          <button
            className="btn-primary"
            onClick={() => {
              const seed = Number(seedInput) || 0;
              if (historyYears > 0) sim.genesis(seed, historyYears);
              else sim.reset(seed);
              setMenuOpen(false);
            }}
            disabled={sim.busy}
          >
            {historyYears > 0 ? 'Forge world' : 'New world'}
          </button>
          <label>
            seed
            <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} size={8} />
          </label>
          <label>
            history
            <select value={historyYears} onChange={(e) => setHistoryYears(Number(e.target.value))} disabled={sim.busy}>
              <option value={0}>none</option>
              <option value={100}>1 century</option>
              <option value={200}>2 centuries</option>
              <option value={500}>5 centuries</option>
            </select>
          </label>
          <span className="time-inline">
            <button onClick={() => sim.advance(1)} disabled={sim.busy}>+1y</button>
            <button onClick={() => sim.advance(10)} disabled={sim.busy}>+10y</button>
            <button onClick={() => sim.advance(60)} disabled={sim.busy}>+60y</button>
          </span>
          <span className="ctl-sep" />
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            size={9}
            title="save slot name"
            aria-label="save name"
          />
          <button onClick={() => sim.save(saveName.trim() || 'quicksave')} disabled={sim.busy || !stat} title="save the world to this slot">
            Save
          </button>
          <button
            onClick={() => sim.load(saveName.trim() || 'quicksave')}
            disabled={sim.busy || !sim.saves.some((s) => s.name === (saveName.trim() || 'quicksave'))}
            title="load this slot"
          >
            Load
          </button>
          {sim.saves.length > 0 && (
            <select
              value=""
              disabled={sim.busy}
              onChange={(e) => {
                if (e.target.value) {
                  setSaveName(e.target.value);
                  sim.load(e.target.value);
                }
              }}
              title="load an existing save"
            >
              <option value="">load save…</option>
              {sim.saves.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} (y{s.year}, seed {s.seed})
                </option>
              ))}
            </select>
          )}
          {sim.busy && <span className="busy">simulating…</span>}
        </div>
      </header>

      {!stat ? (
        <div className="loading">Booting simulation worker…</div>
      ) : (
        <>
          {stat.player ? (
            <PlayerPanel
              player={stat.player}
              onAct={(intent) => sim.playerAct(intent)}
              onRelease={() => sim.release()}
              onInspect={(id) => sim.inspectActor(id)}
              onRef={inspectRef}
              onChooseAmbition={(id, target) => sim.chooseAmbition(id, target)}
              onAbandonAmbition={() => sim.abandonAmbition()}
              busy={sim.busy}
            />
          ) : onboardDismissed ? null : (
            <div className="onboard">
              <span>
                ▶ <strong>Live as one of them.</strong> Click the ▶ beside any soul
                (in “Notable folk” below, or in the inspector) to take up their life. You’ll
                be given a purpose and live a week at a time — and the world goes on around you.
              </span>
              <button className="onboard-x" aria-label="dismiss" onClick={() => setOnboardDismissed(true)}>
                ×
              </button>
            </div>
          )}
          <main className="grid" data-tab={tab}>
            <Dashboard
              stat={stat}
              onPickActor={inspectActor}
              onFocus={(id) => sim.focusSettlement(id)}
              onInspectSettlement={(id) => inspectRef({ kind: 'settlement', id })}
              onSetStoryteller={(id) => sim.setStoryteller(id)}
              onPossess={(id) => sim.possess(id)}
              busy={sim.busy}
            />
            <HistoryFeed
              events={stat.recentEvents}
              eras={stat.eras}
              legends={stat.chronicle}
              figures={stat.historicalFigures}
              houses={stat.houses}
              tongues={stat.tongues}
              focusedName={stat.settlementName}
              onPickEvent={inspectEvent}
              onRef={inspectRef}
            />
            <Inspector
              actorDetail={sim.actorDetail}
              eventChain={sim.eventChain}
              figureDetail={sim.figureDetail}
              settlementDetail={sim.settlementDetail}
              settlements={stat.settlements}
              playerId={stat.player?.id}
              onPickActor={inspectActor}
              onPickEvent={inspectEvent}
              onRef={inspectRef}
              onFocus={(id) => sim.focusSettlement(id)}
              onPossess={(id) => sim.possess(id)}
              onClose={sim.clearInspect}
            />
          </main>
          <nav className="bottombar">
            <div className="time-bar">
              <button onClick={() => sim.advance(1)} disabled={sim.busy}>+1 year</button>
              <button onClick={() => sim.advance(10)} disabled={sim.busy}>+10 years</button>
              <button onClick={() => sim.advance(60)} disabled={sim.busy}>+60 years</button>
            </div>
            <div className="tabs" role="tablist">
              {NAV_TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  className={tab === t.id ? 'active' : ''}
                  aria-current={tab === t.id ? 'page' : undefined}
                  aria-label={t.label}
                  onClick={() => setTab(t.id)}
                >
                  <span className="tab-icon">{t.icon}</span>
                  <span className="tab-label">{t.label}</span>
                </button>
              ))}
            </div>
          </nav>
        </>
      )}
      <footer className="foot">
        Deterministic worker-isolated ECS sim · same seed ⇒ identical history ·
        click any event to trace its causes
      </footer>
    </div>
  );
}

const MAP_VB = { x: -10, y: -12, w: 190, h: 193 };
// fallbacks so the backdrop always matches the WORLD's substrate, whatever skin is picked:
// a galaxy renders as a starfield, a surface world as terrain.
const STAR_FIELD = (MAP_STYLES.find((s) => s.style.kind === 'starfield')?.style as Extract<MapStyle, { kind: 'starfield' }> | undefined)?.field;
const SURF_THEME = (MAP_STYLES.find((s) => s.style.kind === 'surface')?.style as Extract<MapStyle, { kind: 'surface' }> | undefined)?.theme;

function RegionMap({
  map,
  seed,
  focusedId,
  onInspect,
  busy,
}: {
  map: NonNullable<ReturnType<typeof useSim>['snapshot']>['map'];
  seed: number;
  focusedId: number;
  onInspect: (id: number) => void;
  busy: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const movedRef = useRef(false);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{ name: string; meaning?: string; sub: string; cx: number; cy: number } | null>(null);

  // the world IS its substrate (regenerated from the seed); the SUBSTRATE decides the
  // backdrop — a galaxy paints space, a surface world paints its biome terrain. There is
  // no "skin" to pick: how a world looks is what it physically is.
  const sub = useMemo(() => createSubstrate(seed), [seed]);
  const isStarfield = sub instanceof StarfieldSubstrate;

  // the atlas layer: the generator's named features, each in the world's old tongue
  const mapLabels = useMemo<TerrainLabel[]>(
    () =>
      sub instanceof SurfaceSubstrate
        ? sub.geography.features.map((f) => ({ x: f.center.x, y: f.center.y, text: featureName(seed, f).name, kind: f.kind }))
        : [],
    [seed, sub],
  );

  // a STARFIELD is painted once (it rides the CSS zoom transform — space has no per-zoom detail).
  useEffect(() => {
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap || !(sub instanceof StarfieldSubstrate)) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(2, Math.round(rect.width * dpr));
    c.height = Math.max(2, Math.round(rect.height * dpr));
    if (STAR_FIELD) paintStarfield(c, seed, STAR_FIELD);
  }, [seed, sub]);

  // a SURFACE world re-paints the VISIBLE region at native resolution whenever the view
  // changes — so zooming reveals real detail instead of upscaling a fixed bitmap (no blur).
  useEffect(() => {
    if (!(sub instanceof SurfaceSubstrate) || !SURF_THEME) return;
    const paint = () => {
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      if (!c || !wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.min(1600, Math.round(rect.width * dpr));
      c.height = Math.min(1600, Math.round(rect.height * dpr));
      // the world rectangle currently visible through the zoom/pan transform
      const s = view.s;
      const vb = {
        x: MAP_VB.x + (-view.x / s) * (MAP_VB.w / rect.width),
        y: MAP_VB.y + (-view.y / s) * (MAP_VB.h / rect.height),
        w: MAP_VB.w / s,
        h: MAP_VB.h / s,
      };
      paintTerrain(c, sub.geography, vb, SURF_THEME, mapLabels);
    };
    const id = requestAnimationFrame(paint);
    window.addEventListener('resize', paint); // keep the bitmap at the box's native size
    // repaint when the tab returns to the foreground (rAF is paused while hidden, which
    // would otherwise leave a stale/blank terrain until the next view change)
    const onVisible = () => document.visibilityState === 'visible' && paint();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', paint);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [seed, sub, view, mapLabels]);

  // reset the explored view when the world or skin changes
  useEffect(() => setView({ s: 1, x: 0, y: 0 }), [seed]);

  const clampView = (v: { s: number; x: number; y: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return v;
    return { s: v.s, x: Math.min(0, Math.max(r.width * (1 - v.s), v.x)), y: Math.min(0, Math.max(r.height * (1 - v.s), v.y)) };
  };
  const zoomAt = (cx: number, cy: number, factor: number) =>
    setView((v) => {
      const ns = Math.min(6, Math.max(1, v.s * factor));
      return clampView({ s: ns, x: cx - ((cx - v.x) / v.s) * ns, y: cy - ((cy - v.y) / v.s) * ns });
    });
  const zoomCenter = (factor: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) zoomAt(r.width / 2, r.height / 2, factor);
  };

  // wheel zoom (non-passive so it doesn't scroll the page)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: RPointerEvent) => {
    // NB: don't capture the pointer here — it would swallow clicks on nodes/buttons.
    // We capture only once a real drag begins (below).
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;
    pinchDist.current = 0;
  };
  const onPointerMove = (e: RPointerEvent) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.current.values()];
    if (pts.length >= 2) {
      const [p1, p2] = pts;
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const r = wrapRef.current!.getBoundingClientRect();
      if (pinchDist.current) zoomAt((p1.x + p2.x) / 2 - r.left, (p1.y + p2.y) / 2 - r.top, dist / pinchDist.current);
      pinchDist.current = dist;
      movedRef.current = true;
    } else {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        movedRef.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId); // keep dragging smoothly past the edge
      }
      if (movedRef.current) setView((v) => clampView({ s: v.s, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onPointerUp = (e: RPointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchDist.current = 0;
  };

  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  // roads follow the region graph across the real terrain — recomputed only when the
  // world (nodes/edges) changes, not on pan/zoom. Surface worlds only (a galaxy has none).
  const roads = useMemo(
    () => (sub instanceof SurfaceSubstrate ? buildRoads(sub.geography, map.nodes, map.edges) : []),
    [sub, map.nodes, map.edges],
  );
  // great rivers, traced from the drainage tree as meandering vectors (width ∝ discharge).
  // Depends only on the world, not nodes/edges — recomputed when the world changes.
  const rivers = useMemo(
    () => (sub instanceof SurfaceSubstrate ? buildRivers(sub.geography) : []),
    [sub],
  );
  const maxPop = Math.max(1, ...map.nodes.map((n) => n.population));
  const radius = (pop: number) => 1.7 + 3.4 * Math.sqrt(pop / maxPop);
  // on a big, busy map only the GREATEST cities are labelled (others are dots with a
  // hover name) — zoom in to read them all, like a world atlas.
  const labelIds = new Set(
    [...map.nodes].sort((a, b) => b.population - a.population).slice(0, 14).map((n) => n.id),
  );
  const showLabels = view.s > 2.2;

  return (
    <div
      ref={wrapRef}
      className={`map-wrap${isStarfield ? ' starfield' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* The terrain canvas is DECOUPLED from the zoom transform: instead of stretching a
          fixed bitmap (which blurred when zoomed), it re-paints the VISIBLE region at native
          resolution as the view changes (see the paint effect). A starfield has no per-zoom
          detail to gain, so it keeps the cheap CSS-transform path. */}
      <canvas
        ref={canvasRef}
        className="map-terrain"
        style={isStarfield ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0' } : undefined}
      />
      <div className="map-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0' }}>
        <svg className="map" viewBox={`${MAP_VB.x} ${MAP_VB.y} ${MAP_VB.w} ${MAP_VB.h}`} preserveAspectRatio="xMidYMid meet">
          {/* GREAT RIVERS: traced from the drainage as meandering vectors, width ∝ discharge.
              Drawn first so roads and bridges sit on top; the fine tributary web is painted
              into the terrain canvas underneath. */}
          {rivers.map((rv, i) => (
            <path
              key={`rv${i}`}
              className="river"
              d={rv.d}
              fill="none"
              stroke="var(--cyan)"
              strokeWidth={rv.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.5}
            />
          ))}
          {/* ROADS: the physical links between peaceful settlements — overland roads hug
              the valleys, sea lanes cross the water (design: RimWorld draws world roads). */}
          {roads.map((rd, i) => (
            <path
              key={`rd${i}`}
              className={`road ${rd.kind}`}
              d={rd.d}
              fill="none"
              stroke={rd.kind === 'sea' ? 'var(--cyan)' : 'var(--neutral)'}
              strokeWidth={rd.width}
              strokeDasharray={rd.kind === 'sea' ? '0.9 1.3' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={rd.kind === 'sea' ? 0.32 : 0.5}
            />
          ))}
          {/* hostile borders stay straight — a contested march, not a road */}
          {map.edges.filter((e) => e.relation < -20).map((e, i) => {
            const a = nodeById.get(e.a)!;
            const b = nodeById.get(e.b)!;
            return (
              <line key={`h${i}`} className="edge hostile" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--rose)" strokeWidth={0.5} strokeDasharray="1 1" opacity={0.7} />
            );
          })}
          {/* nodes: coloured by culture, sized by population; hover for a glance, click for its story */}
          {map.nodes.map((n) => {
            const focused = n.id === focusedId;
            const r = n.ruined ? 1.9 : radius(n.population);
            const color = cultureColor(n.cultureId);
            const sub = n.ruined ? 'a ruin' : `${cultureName(n.cultureId)} · ${n.population} souls`;
            const enter = (e: RMouseEvent) => setHover({ name: n.name, meaning: n.nameMeaning, sub, cx: e.clientX, cy: e.clientY });
            return (
              <g
                key={n.id}
                className={busy ? 'mnode' : 'mnode clickable'}
                onClick={() => {
                  if (movedRef.current) return;
                  if (!busy) onInspect(n.id);
                }}
                onMouseMove={enter}
                onMouseLeave={() => setHover(null)}
              >
                {focused && <circle className="focus-ring" cx={n.x} cy={n.y} r={r + 1.8} fill="none" stroke="var(--gold)" strokeWidth={0.7} />}
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill={n.ruined ? 'none' : color}
                  stroke={n.ruined ? 'var(--rose)' : 'rgba(8,10,14,0.55)'}
                  strokeWidth={n.ruined ? 0.5 : 0.4}
                  strokeDasharray={n.ruined ? '0.8 0.8' : undefined}
                  opacity={n.ruined ? 0.6 : 0.94}
                />
                {(labelIds.has(n.id) || focused || showLabels) && (
                  <text
                    x={n.x}
                    y={n.y - r - 1.3}
                    textAnchor="middle"
                    fontSize="2.8"
                    fill={n.ruined ? 'var(--rose)' : 'var(--ink-dim)'}
                    stroke="rgba(8,9,13,0.9)"
                    strokeWidth={0.7}
                    style={{ paintOrder: 'stroke' }}
                    opacity={n.ruined ? 0.8 : 1}
                  >
                    {n.ruined ? `⚑ ${n.name}` : n.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* atmosphere + controls (fixed — not part of the explored view) */}
      <svg className="compass" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        <path d="M20 5 L23 20 L20 35 L17 20 Z" fill="currentColor" opacity="0.7" />
        <path d="M5 20 L20 17 L35 20 L20 23 Z" fill="currentColor" opacity="0.35" />
        <text x="20" y="4.5" textAnchor="middle" fontSize="5" fill="currentColor">N</text>
      </svg>
      <div className="map-ctl">
        <button onClick={() => zoomCenter(1.4)} title="zoom in" aria-label="zoom in">+</button>
        <button onClick={() => zoomCenter(1 / 1.4)} title="zoom out" aria-label="zoom out">−</button>
        <button onClick={() => setView({ s: 1, x: 0, y: 0 })} title="reset view" aria-label="reset view">⤢</button>
      </div>
      {hover && (
        <div className="map-tip" style={{ left: hover.cx + 14, top: hover.cy + 14 }}>
          <strong>{hover.name}</strong>
          {hover.meaning && <span className="tip-meaning">“{hover.meaning}”</span>}
          <span className="muted">{hover.sub}</span>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  stat,
  onPickActor,
  onFocus,
  onInspectSettlement,
  onSetStoryteller,
  onPossess,
  busy,
}: {
  stat: NonNullable<ReturnType<typeof useSim>['snapshot']>;
  onPickActor: (id: number) => void;
  onFocus: (id: number) => void;
  onInspectSettlement: (id: number) => void;
  onSetStoryteller: (id: string) => void;
  onPossess: (id: number) => void;
  busy: boolean;
}) {
  const [showAllSettlements, setShowAllSettlements] = useState(false);
  const SETTLEMENT_CAP = 12;
  // keep the place you're watching at the top; the list is a secondary selector (the map
  // is the primary one), so cap it and let the player expand for the full roll.
  const orderedSettlements = [...stat.settlements].sort((a, b) => (b.detailed ? 1 : 0) - (a.detailed ? 1 : 0));
  const visibleSettlements = showAllSettlements ? orderedSettlements : orderedSettlements.slice(0, SETTLEMENT_CAP);
  const hiddenCount = stat.settlements.length - visibleSettlements.length;

  return (
    <section className="panel dashboard">
      <h2>Year {stat.year}</h2>

      <div className="worldscale">
        <div>
          <span className="ws-num">{stat.worldPopulation.toLocaleString()}</span> souls draw breath
          across {stat.settlements.length} settlements
        </div>
        <div className="muted">
          Only {stat.settlementName} is lived in full — its <strong>{stat.simulatedInDetail}</strong> souls
          known by name and deed; the rest live on in chronicle and rumour.
        </div>
      </div>

      <div className="map-head">
        <h3>Map of the known world — click a settlement to read its tale</h3>
      </div>
      <RegionMap map={stat.map} seed={stat.seed} focusedId={stat.focusedSettlementId} onInspect={onInspectSettlement} busy={busy} />
      <div className="legend">
        <span><i className="sw good" /> trade</span>
        <span><i className="sw bad" /> war</span>
        <span>● size = population</span>
      </div>
      <div className="legend cultures">
        {[...new Set(stat.map.nodes.map((n) => n.cultureId))].map((id) => (
          <span key={id}>
            <i className="cdot" style={{ background: cultureColor(id) }} /> {cultureName(id)}
          </span>
        ))}
      </div>

      <section className="focus-panel">
        <h3>{stat.settlementName} · where your gaze rests</h3>
        <div className="stats">
          <Stat label="Souls" value={stat.population} />
          <Stat label="Births" value={stat.totalBorn} />
          <Stat label="Deaths" value={stat.totalDied} />
          <Stat label="Marriages" value={stat.marriages} />
          <Stat label="Feuds" value={stat.feuds} />
        </div>
        <h4 className="live-as-head">Notable folk — press ▶ to live one of their lives</h4>
        <ul className="notable">
          {stat.notable.map((a) => (
            <li key={a.id}>
              <button
                className="play-btn"
                onClick={() => onPossess(a.id)}
                disabled={busy || a.id === stat.player?.id}
                aria-label={a.id === stat.player?.id ? `You live as ${a.name}` : `Live as ${a.name}`}
                title={a.id === stat.player?.id ? 'you live as this soul' : 'live as this soul'}
              >
                {a.id === stat.player?.id ? '◉' : '▶'}
              </button>{' '}
              <button className="link" onClick={() => onPickActor(a.id)}>
                {a.name}
              </button>
              <span className="muted">
                {' '}
                · {a.species} {a.profession}, {a.ageYears}y · {a.relationshipCount} ties
              </span>
            </li>
          ))}
        </ul>
      </section>

      <h3>Settlements — turn your gaze elsewhere</h3>
      <ul className="settlements">
        {visibleSettlements.map((s) => (
          <li key={s.id} className={`${s.detailed ? 'focused' : ''} ${s.ruinedYear !== undefined ? 'is-ruin' : ''}`}>
            <button
              className="focus-btn"
              disabled={busy || s.detailed || s.population === 0}
              onClick={() => onFocus(s.id)}
              title={
                s.detailed
                  ? 'your gaze rests here'
                  : s.population === 0
                    ? 'abandoned — none remain'
                    : 'turn your gaze here, and live it in full'
              }
            >
              <span className="set-name">
                <span className="set-mark">{s.detailed ? '◉' : s.ruinedYear !== undefined ? '⚑' : '○'}</span>
                {s.name}
                {s.ruinedYear === undefined && <span className="set-pop">{s.population.toLocaleString()}</span>}
              </span>
              {s.ruinedYear !== undefined ? (
                <span className="set-meta ruin">ruin · fell y{s.ruinedYear}</span>
              ) : (
                <span className="set-meta">
                  {s.dominantSpecies} · {s.specialization} · {s.wealth}w ·{' '}
                  <span className={subsistenceClass(s.subsistenceSecurity)}>{subsistenceLabel(s.subsistenceSecurity)}</span>
                  {' · '}
                  <span className="figs">{s.culture}</span>
                  {s.leaderTitle && s.ruler ? (
                    <span className="ruler"> · {s.leaderTitle} {s.ruler}</span>
                  ) : !s.leaderTitle ? (
                    <span className="figs"> · free folk</span>
                  ) : null}
                  {s.figureNames.length > 0 && (
                    <span className="figs"> · still there: {s.figureNames.join(', ')}</span>
                  )}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {(hiddenCount > 0 || showAllSettlements) && (
        <button className="link more-toggle" onClick={() => setShowAllSettlements((v) => !v)}>
          {showAllSettlements ? 'show fewer' : `show all ${stat.settlements.length} settlements`}
        </button>
      )}

      <h3>The tone of this age</h3>
      <div className="storyteller footer">
        <label>
          The Fates:{' '}
          <select
            value={stat.director.personality}
            disabled={busy}
            onChange={(e) => onSetStoryteller(e.target.value)}
          >
            {stat.director.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          {' '}
          · {stat.director.mood} · {stat.director.incidents} turns of fate
        </span>
        <div className="tension-bar" title="the gathering temper of the age">
          <div className="tension-fill" style={{ width: `${Math.min(100, stat.director.tension / 2)}%` }} />
        </div>
      </div>
    </section>
  );
}

const STORY_ICON: Record<string, string> = {
  married: '💍', friendship: '🤝', feud: '⚔', rivalry: '⚔', born: '👶', died: '⚰',
  ascension: '👑', dynasty: '👑', goal_met: '✓', brawl: '⚔', widowed: '🖤', exile: '🚪',
};

/** A block of live threads — present tensions, beliefs, opportunities, or worries. Each is a short
 *  line, clickable when it points at a person. Hidden when empty unless an `emptyText` is given. */
function Threads({ head, items, onRef, emptyText }: { head: string; items: Tension[]; onRef: (ref: EventRef) => void; emptyText?: string }) {
  if (items.length === 0 && !emptyText) return null;
  return (
    <div className="whats-happening">
      <h4 className="wh-head">{head}</h4>
      {items.length === 0 ? (
        <p className="thread-empty muted">{emptyText}</p>
      ) : (
      <ul className="tensions">
        {items.map((t, i) => (
          <li key={i} className="tension">
            <span className="t-icon" aria-hidden="true">{t.icon}</span>{' '}
            {t.ref ? (
              <span
                className="ev-inspect"
                role="button"
                tabIndex={0}
                onClick={() => onRef(t.ref!)}
                onKeyDown={(e) => onActivate(e, () => onRef(t.ref!))}
              >
                {t.text}
              </span>
            ) : (
              <span>{t.text}</span>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

/** YOUR VIEW OF THE WORLD — the player's own subjective reality, elevated as the thesis it is.
 *  Certainty (what you KNOW) is set visually apart from absence of knowledge (news not yet
 *  arrived) and, later, contested claims and rumor (design/21 §3–4). */
function WorldView({ items, onRef }: { items: Tension[]; onRef: (ref: EventRef) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="worldview">
      <h4 className="wv-head">Your world</h4>
      <ul className="wv-list">
        {items.map((t, i) => (
          <li key={i} className={`wv-item c-${t.certainty ?? 'known'}`}>
            <span className="wv-icon" aria-hidden="true">{t.icon}</span>{' '}
            {t.ref ? (
              <span
                className="ev-inspect"
                role="button"
                tabIndex={0}
                onClick={() => onRef(t.ref!)}
                onKeyDown={(e) => onActivate(e, () => onRef(t.ref!))}
              >
                {t.text}
              </span>
            ) : (
              <span>{t.text}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** WHAT DESERVES MY ATTENTION — one feed, sorted by importance, notification-style. People, changes,
 *  openings and worries merged (design/21 §7). Replaces four sections and the cast row. */
function Attention({ items, onRef }: { items: Tension[]; onRef: (ref: EventRef) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="attention">
      <h4 className="wh-head">What deserves your attention</h4>
      <ul className="att-list">
        {items.map((t, i) => (
          <li key={i} className="att-item">
            <span className="att-icon" aria-hidden="true">{t.icon}</span>
            {t.ref ? (
              <span
                className="ev-inspect"
                role="button"
                tabIndex={0}
                onClick={() => onRef(t.ref!)}
                onKeyDown={(e) => onActivate(e, () => onRef(t.ref!))}
              >
                {t.text}
              </span>
            ) : (
              <span>{t.text}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** THE JOURNAL — reflective, not actionable: the full categorized streams and your life so far.
 *  Behind one click so the cockpit stays a cockpit (design/21 §6). Story lives here — nobody
 *  deciding what to do this week needs their wedding from 40 years ago. */
function Journal({ player, onRef }: { player: PlayerView; onRef: (ref: EventRef) => void }) {
  return (
    <details className="journal">
      <summary className="journal-head">Open the journal</summary>
      <div className="journal-body">
        <Threads head="What's changing around you" items={player.tensions} onRef={onRef} />
        <Threads head="What could change your life" items={player.opportunities} onRef={onRef} emptyText="Nothing obvious right now." />
        <Threads head="What might go wrong" items={player.threats} onRef={onRef} />
        {player.story.length > 0 && (
          <div className="whats-happening">
            <h4 className="wh-head">Your story so far</h4>
            <ul className="story-beats">
              {player.story.slice(-12).reverse().map((b, i) => (
                <li key={i} className={`ev ${TYPE_TONE[b.tone] ?? 'neutral'}`}>
                  <span className="beat-icon" aria-hidden="true">{STORY_ICON[b.tone] ?? '•'}</span> <EventText parts={b.parts} onRef={onRef} />
                  {b.note && <span className="muted"> — {b.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function PlayerPanel({
  player,
  onAct,
  onRelease,
  onInspect,
  onRef,
  onChooseAmbition,
  onAbandonAmbition,
  busy,
}: {
  player: PlayerView;
  onAct: (intent: Intent) => void;
  onRelease: () => void;
  onInspect: (id: number) => void;
  onRef: (ref: EventRef) => void;
  onChooseAmbition: (id: string, target?: number) => void;
  onAbandonAmbition: () => void;
  busy: boolean;
}) {
  const [actionKind, setActionKind] = useState<PlayerView['actions'][number]['kind']>('work');
  const [targetId, setTargetId] = useState<number | ''>('');

  const action = player.actions.find((a) => a.kind === actionKind) ?? player.actions[0];
  const needsTarget = action.needsTarget;
  const canAct = player.alive && !busy && (!needsTarget || targetId !== '');

  const submit = () => {
    if (!canAct) return;
    const intent: Intent = needsTarget
      ? ({ kind: actionKind, target: Number(targetId) } as Intent)
      : ({ kind: actionKind } as Intent);
    onAct(intent);
  };

  return (
    <section className="panel player-panel">
      <div className="player-head">
        <div>
          <span className="player-tag">▶ Playing as</span>{' '}
          <button className="link strong" onClick={() => onInspect(player.id)}>
            {player.name}
          </button>{' '}
          <span className="muted">
            — {player.species} {player.profession}, {player.ageYears}y · {player.settlement}
          </span>
        </div>
        <button className="link" onClick={onRelease} disabled={busy}>
          release
        </button>
      </div>

      {!player.alive ? (
        <p className="player-dead">
          You died{player.deathYear !== undefined ? ` in year ${player.deathYear}` : ''}. The
          world goes on without you — release to keep watching, or advance time.
        </p>
      ) : (
        <>
          <AmbitionBanner
            ambition={player.ambition}
            offered={player.offeredAmbitions}
            onAct={onAct}
            onRef={onRef}
            onChoose={onChooseAmbition}
            onAbandon={onAbandonAmbition}
            busy={busy}
          />
          {player.decisions.length > 0 && (
            <div className="decisions" aria-label="the world asks">
              {player.decisions.map((d) => (
                <DecisionCard key={d.id} d={d} onAct={onAct} onRef={onRef} busy={busy} />
              ))}
            </div>
          )}
          {player.lastAchieved && <div className="achieved">✓ {player.lastAchieved}</div>}

          {/* THE DOMINANT QUESTION — the one thing that should make you press Advance.
              A narrator's reading of where you stand, not a quest tracker (design/21 §1–2). */}
          <div className="situation">
            {/* the derived aspiration narration shows only when no ambition is committed —
                otherwise the ⚑ ambition (above) IS the goal, and this is just the free-action tail. */}
            {!player.ambition && (
              <>
                <div className="situation-head">
                  <span className="situation-tag">Current situation</span>
                  {player.aspiration.suggested && (
                    <button
                      className="act-btn goal-pursue"
                      onClick={() => onAct(player.aspiration.suggested!)}
                      disabled={busy}
                      title="take the action your character is driven toward"
                    >
                      Pursue ▸
                    </button>
                  )}
                </div>
                <p className="situation-aim">{player.aspiration.label}</p>
                {player.aspiration.obstacle && <p className="situation-read">{player.aspiration.obstacle}</p>}
              </>
            )}
            {/* MOOD — how this life feels, with every reason on hover (mood.ts) */}
            <p
              className={`situation-mood ${player.mood.value < 250 ? 'mood-bad' : player.mood.value < 400 ? 'mood-warn' : player.mood.value < 600 ? '' : 'mood-good'}`}
              title={player.mood.reasons.map((r) => `${r.value >= 0 ? '+' : ''}${r.value} ${r.label}`).join('\n')}
            >
              Spirits: {player.mood.word.toLowerCase()}
            </p>
            {player.bodyNote && <p className="situation-body">{player.bodyNote}</p>}
            {!player.ambition && player.aspiration.progress !== undefined && (
              <div className="goal-progress" title={`${Math.round(player.aspiration.progress * 100)}% of the way`}>
                <div className="goal-progress-fill" style={{ width: `${Math.round(player.aspiration.progress * 100)}%` }} />
              </div>
            )}
            {!player.ambition && player.aspiration.nextStep && (
              <p className="situation-step"><span className="step-label">Best next step</span> {player.aspiration.nextStep}</p>
            )}

            {/* the action belongs right here — the page should read top-to-bottom like a thought:
                here's where I stand, so here's what I'll do (design/21 §7). With a committed ambition
                (whose step shows above), the derived-goal read is hidden and this is the free tail. */}
            {player.ambition && <span className="situation-tag act-lead">Or — do something else</span>}
            <div className="action-bar">
              <select
                value={actionKind}
                onChange={(e) => setActionKind(e.target.value as typeof actionKind)}
                disabled={busy}
              >
                {player.actions.map((a) => (
                  <option key={a.kind} value={a.kind}>
                    {a.label}
                  </option>
                ))}
              </select>
              {needsTarget && (
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value === '' ? '' : Number(e.target.value))}
                  disabled={busy}
                >
                  <option value="">— choose someone —</option>
                  {player.targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.relation}
                      {t.relation !== 'stranger' ? ` ${t.valence >= 0 ? '+' : ''}${t.valence}` : ''})
                    </option>
                  ))}
                </select>
              )}
              <button className="act-btn" onClick={submit} disabled={!canAct}>
                {action.label} ▸ (1 week)
              </button>
              <span className="muted action-hint">{action.hint}</span>
            </div>
          </div>

          {/* QUESTION 2 — one feed, people and events merged, sorted by importance. */}
          <Attention items={player.attention} onRef={onRef} />

          {/* QUESTION 3 — what you currently believe to be true. Everything else is one click away. */}
          <WorldView items={player.belief} onRef={onRef} />
          <Journal player={player} onRef={onRef} />
        </>
      )}

      {!player.alive && player.story.length > 0 && (
        <details className="player-story" open>
          <summary className="story-head">Your story so far</summary>
          <ul className="story-beats">
            {player.story.slice(-12).reverse().map((b, i) => (
              <li key={i} className={`ev ${TYPE_TONE[b.tone] ?? 'neutral'}`}>
                <span className="beat-icon" aria-hidden="true">{STORY_ICON[b.tone] ?? '•'}</span> <EventText parts={b.parts} onRef={onRef} />
                {b.note && <span className="muted"> — {b.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

const FEED_FLOOR = 1; // interest below this is banal — digested (focused place) or dropped
// the focused place's demographic flux is worth a per-year tally; pure social chitchat
// (friendships, kindnesses, quarrels) is left to a person's inspector, never the feed.
const DIGEST_CAT: Record<string, string> = {
  born: 'births',
  immigrated: 'comings & goings',
  emigrated: 'comings & goings',
};
type FeedItem =
  | { kind: 'event'; ev: EventView }
  | { kind: 'digest'; year: number; counts: Record<string, number> };
const itemYear = (it: FeedItem) => (it.kind === 'event' ? it.ev.year : it.year);

/** Turn the raw event stream into a readable feed: in "notable" mode, momentous events (and
 *  anything touching the player) show individually, the focused place's everyday happenings
 *  are folded into a per-year digest, and distant villages' chitchat is dropped. "everything"
 *  is the raw firehose. Scope narrows to the focused settlement. */
function processFeed(events: EventView[], scope: 'world' | 'place', mode: 'notable' | 'all'): FeedItem[] {
  const evs = scope === 'place' ? events.filter((e) => e.local) : events;
  if (mode === 'all') return evs.slice(0, 200).map((ev) => ({ kind: 'event', ev }));
  const items: FeedItem[] = [];
  const digests = new Map<number, Record<string, number>>();
  for (const ev of evs) {
    if (ev.interest >= FEED_FLOOR || ev.involvesPlayer) {
      items.push({ kind: 'event', ev });
    } else if (ev.local && DIGEST_CAT[ev.type]) {
      const cat = DIGEST_CAT[ev.type];
      const d = digests.get(ev.year) ?? {};
      d[cat] = (d[cat] ?? 0) + 1;
      digests.set(ev.year, d);
    }
    // else: routine social chitchat (or a distant village's) — left to the inspector, not the feed
  }
  for (const [year, counts] of digests) items.push({ kind: 'digest', year, counts });
  items.sort((a, b) => itemYear(b) - itemYear(a)); // newest first (stable: digest trails its year)
  return items.slice(0, 120);
}

function HistoryFeed({
  events,
  eras,
  legends,
  figures,
  houses,
  tongues,
  focusedName,
  onPickEvent,
  onRef,
}: {
  events: EventView[];
  eras: EraView[];
  legends: TaleView[];
  figures: FigureView[];
  houses: HouseView[];
  tongues: TongueView[];
  focusedName: string;
  onPickEvent: (id: number) => void;
  onRef: (ref: EventRef) => void;
}) {
  const [view, setView] = usePersistentState<'recent' | 'legends' | 'tongues'>('mythos.feed.view', 'recent');
  const [scope, setScope] = usePersistentState<'world' | 'place'>('mythos.feed.scope', 'world');
  const [mode, setMode] = usePersistentState<'notable' | 'all'>('mythos.feed.mode', 'notable');
  const items = useMemo(() => processFeed(events, scope, mode), [events, scope, mode]);

  return (
    <section className="panel feed">
      <h2>The chronicle</h2>
      {/* Recent = the unfolding stream; Legends & Ages = the enshrined deep history */}
      <div className="seg view-tabs" role="group" aria-label="history view">
        <button className={view === 'recent' ? 'on' : ''} onClick={() => setView('recent')}>Recent</button>
        <button className={view === 'legends' ? 'on' : ''} onClick={() => setView('legends')}>Legends &amp; Ages</button>
        <button className={view === 'tongues' ? 'on' : ''} onClick={() => setView('tongues')}>Tongues</button>
      </div>

      {view === 'recent' ? (
        <>
          <div className="feed-controls" role="group" aria-label="history filters">
            <div className="seg" role="group" aria-label="scope">
              <button className={scope === 'world' ? 'on' : ''} onClick={() => setScope('world')}>The world</button>
              <button className={scope === 'place' ? 'on' : ''} onClick={() => setScope('place')}>{focusedName}</button>
            </div>
            <div className="seg" role="group" aria-label="detail">
              <button className={mode === 'notable' ? 'on' : ''} onClick={() => setMode('notable')}>Notable</button>
              <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>Everything</button>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="muted">Nothing of note yet — advance the years, or switch to “Everything”.</p>
          ) : (
            <ul>
              {items.map((it) =>
                it.kind === 'event' ? (
                  <li key={`e${it.ev.id}`} className={`ev ${TYPE_TONE[it.ev.type] ?? 'neutral'}`}>
                    {/* click a name to inspect it · click anywhere else to trace the causes */}
                    <div
                      className="ev-row"
                      onClick={() => onPickEvent(it.ev.id)}
                      onKeyDown={(e) => onActivate(e, () => onPickEvent(it.ev.id))}
                      role="button"
                      tabIndex={0}
                      title="trace causes"
                    >
                      <span className="ev-year">y{it.ev.year}</span> <EventText parts={it.ev.parts} onRef={onRef} />
                      {it.ev.causes.length > 0 && <span className="why"> · why?</span>}
                    </div>
                  </li>
                ) : (
                  <li key={`d${it.year}`} className="ev digest">
                    <div className="ev-row digest-row">
                      <span className="ev-year">y{it.year}</span>{' '}
                      <span className="muted">
                        in {focusedName}:{' '}
                        {Object.entries(it.counts)
                          .map(([cat, n]) => `${n} ${cat}`)
                          .join(' · ')}
                      </span>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      ) : view === 'tongues' ? (
        tongues.length === 0 ? (
          <p className="muted">No living tongues — this world has no peoples to speak them.</p>
        ) : (
          <div className="tongues">
            {tongues.map((t) => (
              <div key={t.cultureId} className="tongue">
                <h3>
                  {cultureName(t.cultureId)} — <span className="tongue-demonym">the {t.demonym}</span>
                  <span className="tongue-voice"> · a {t.voice} tongue</span>
                </h3>
                {t.kin.length > 0 && (
                  <p className="tongue-kin muted">
                    kin to {t.kin.map((k) => cultureName(k)).join(' and ')} — one mother tongue, long divided
                  </p>
                )}
                {t.kin.length === 0 && <p className="tongue-kin muted">an isolate — kin to no living tongue</p>}
                <p className="tongue-lexicon">
                  {t.lexicon.map((w, i) => (
                    <span key={i} className="lex">
                      <b>{w.root}</b> {w.gloss}
                    </span>
                  ))}
                </p>
                {t.towns.length > 0 && (
                  <p className="tongue-towns muted">
                    their towns: {t.towns.map((tw) => (tw.meaning ? `${tw.name} “${tw.meaning}”` : tw.name)).join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )
      ) : eras.length === 0 && legends.length === 0 && figures.length === 0 && houses.length === 0 ? (
        <p className="muted">No legends yet — the great deeds of this age are still being written.</p>
      ) : (
        <>
          {eras.length > 0 && (
            <>
              <h3>The named ages</h3>
              <ul className="eras">
                {eras.slice(0, 8).map((e, i) => (
                  <li key={i}>
                    <span className="muted">y{e.year}:</span> {e.title}
                  </li>
                ))}
              </ul>
            </>
          )}
          {houses.length > 0 && (
            <>
              <h3>Great Houses — the dynasties of the age</h3>
              <ul className="houses">
                {houses.slice(0, 8).map((h, i) => (
                  <li key={i} className={h.extinctYear !== undefined ? 'house-fallen' : ''}>
                    <span className="house-name">House {h.name}{h.meaning ? <span className="house-gloss"> · {h.meaning}</span> : null}</span>
                    <span className="house-status">
                      {h.extinctYear !== undefined
                        ? `fell with its seat, y${h.extinctYear}`
                        : h.seat
                          ? `rules ${h.seat}`
                          : 'out of power'}
                    </span>
                    <span className="muted house-meta">
                      founded y{h.foundedYear} in {h.origin} · {h.rulers} {h.rulers === 1 ? 'ruler' : 'rulers'} · {h.prestige} renown
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {figures.length > 0 && (
            <>
              <h3>Figures of history</h3>
              <ul className="figures-hist">
                {figures.slice(0, 8).map((f, i) => (
                  <li key={i}>
                    <span className="fig-name">{f.name}</span>
                    <span className="muted">
                      {' '}
                      — {f.role}
                      {f.house ? ` of House ${f.house}` : ''} of {f.settlement},{' '}
                      {f.deathYear !== undefined ? `r.${f.reignStart}–${f.deathYear}` : `since y${f.reignStart}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {legends.length > 0 && (
            <>
              <h3>Legends still told</h3>
              <ul className="legends">
                {legends.slice(0, 12).map((t, i) => (
                  <li key={i}>
                    <span className="muted">y{t.year}</span> {t.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Inspector({
  actorDetail,
  eventChain,
  figureDetail,
  settlementDetail,
  settlements,
  playerId,
  onPickActor,
  onPickEvent,
  onRef,
  onFocus,
  onPossess,
  onClose,
}: {
  actorDetail: ReturnType<typeof useSim>['actorDetail'];
  eventChain: ReturnType<typeof useSim>['eventChain'];
  figureDetail: ReturnType<typeof useSim>['figureDetail'];
  settlementDetail: ReturnType<typeof useSim>['settlementDetail'];
  settlements: SettlementView[];
  playerId?: number;
  onPickActor: (id: number) => void;
  onPickEvent: (id: number) => void;
  onRef: (ref: EventRef) => void;
  onFocus: (id: number) => void;
  onPossess: (id: number) => void;
  onClose: () => void;
}) {
  if (!actorDetail && !eventChain && !figureDetail && !settlementDetail) {
    return (
      <section className="panel inspector empty">
        <h2>A closer look</h2>
        <p className="muted">
          Click any <strong>name</strong> in the history — a person or a place — to look closer, or
          click an event and follow <em>why?</em> to trace what led to it.
        </p>
      </section>
    );
  }

  const settV = settlementDetail ? settlements.find((s) => s.id === settlementDetail.settlementId) : undefined;

  // a clickable history line: click a name to inspect it, click the line to trace its causes
  const eventLine = (ev: EventView) => (
    <li key={ev.id}>
      <span
        className="ev-inspect"
        onClick={() => onPickEvent(ev.id)}
        onKeyDown={(e) => onActivate(e, () => onPickEvent(ev.id))}
        role="button"
        tabIndex={0}
      >
        <span className="ev-year">y{ev.year}</span> <EventText parts={ev.parts} onRef={onRef} />
      </span>
    </li>
  );

  return (
    <section className="panel inspector">
      <div className="inspector-head">
        <h2>A closer look</h2>
        <button className="link" onClick={onClose}>
          close
        </button>
      </div>

      {actorDetail && (
        <div>
          <h3>
            {actorDetail.actor.name}{' '}
            {!actorDetail.actor.alive && <span className="muted">(died y{actorDetail.actor.deathYear})</span>}
            {actorDetail.actor.alive &&
              (actorDetail.actor.id === playerId ? (
                <span className="muted"> · ◉ you</span>
              ) : (
                <button className="play-inline" onClick={() => onPossess(actorDetail.actor.id)}>
                  ▶ live as
                </button>
              ))}
          </h3>
          <p className="muted">
            {actorDetail.actor.species} {actorDetail.actor.profession} · {actorDetail.actor.ageYears}y ·{' '}
            {actorDetail.actor.sex} · of House {actorDetail.actor.house} · traits:{' '}
            {actorDetail.actor.traits.join(', ') || 'none'}
          </p>
          <p className="muted">Nature: {actorDetail.actor.nature}{actorDetail.actor.faith ? ` · faithful to ${actorDetail.actor.faith}` : ' · faithless'}{actorDetail.actor.factionName ? ` · ${actorDetail.actor.factionName}` : ''}{actorDetail.actor.exiledFrom ? <span className="exile-status"> · exile from {actorDetail.actor.exiledFrom}</span> : null}</p>
          {/* a life-story assembled from their REAL history — who they are, and why */}
          {actorDetail.backstory && <p className="backstory">{actorDetail.backstory}</p>}

          {actorDetail.mood && (
            <>
              <h4>
                Mood: {actorDetail.mood.word} <span className="muted">({actorDetail.mood.value})</span>
              </h4>
              {actorDetail.mood.reasons.length > 0 && (
                <div className="reasons">
                  {actorDetail.mood.reasons.map((why, i) => (
                    <span key={i} className={why.value >= 0 ? 'why-pos' : 'why-neg'}>
                      {why.value >= 0 ? '+' : ''}
                      {why.value} {why.label}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {actorDetail.reputation.reasons.length > 0 && (
            <>
              <h4>
                Standing <span className="muted">({actorDetail.reputation.standing})</span>
              </h4>
              <div className="reasons">
                {actorDetail.reputation.reasons.map((why, i) => (
                  <span key={i} className={why.value >= 0 ? 'why-pos' : 'why-neg'}>
                    {why.value >= 0 ? '+' : ''}
                    {why.value} {why.label}
                  </span>
                ))}
              </div>
            </>
          )}

          <h4>Relationships</h4>
          {actorDetail.relationships.length === 0 ? (
            <p className="muted">No relationships.</p>
          ) : (
            <ul className="rels">
              {actorDetail.relationships.slice(0, 14).map((r) => (
                <li key={r.otherId}>
                  <span className={`kind ${r.kind}`}>{r.kind}</span>{' '}
                  <button className="link" onClick={() => onPickActor(r.otherId)}>
                    {r.otherName}
                  </button>{' '}
                  <span className="muted">({r.valence})</span>
                  {r.away && <span className="away"> · away in {r.otherSettlement}</span>}
                  {r.reasons.length > 0 && (
                    <div className="reasons">
                      {r.reasons.map((why, i) => (
                        <span key={i} className={why.value >= 0 ? 'why-pos' : 'why-neg'}>
                          {why.value >= 0 ? '+' : ''}
                          {why.value} {why.label}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h4>Life events</h4>
          <ul className="rels">{actorDetail.lifeEvents.map(eventLine)}</ul>
        </div>
      )}

      {figureDetail && (
        <div>
          <h3>{figureDetail.name}</h3>
          <p className="muted">
            {figureDetail.role}
            {figureDetail.house ? ` of House ${figureDetail.house}` : ''} of{' '}
            <button className="link" onClick={() => onRef({ kind: 'settlement', id: figureDetail.settlementId })}>
              {figureDetail.settlement}
            </button>{' '}
            · {figureDetail.species} · born y{figureDetail.bornYear}
            {figureDetail.deathYear !== undefined ? `, died y${figureDetail.deathYear}` : ' · still remembered'}
          </p>
          <h4>Recorded in history</h4>
          {figureDetail.lifeEvents.length === 0 ? (
            <p className="muted">Nothing recorded.</p>
          ) : (
            <ul className="rels">{figureDetail.lifeEvents.map(eventLine)}</ul>
          )}
        </div>
      )}

      {settlementDetail && (
        <div>
          <h3>{settV?.name ?? 'Settlement'}</h3>
          {settV?.nameMeaning && <p className="name-gloss">“{settV.nameMeaning}”, in the founders’ tongue</p>}
          {settV?.landmark && <p className="name-gloss">{settV.landmark.relation} {settV.landmark.name}</p>}
          {settV && (
            <p className="muted">
              {settV.ruinedYear !== undefined
                ? `a ruin · fell y${settV.ruinedYear}`
                : `${settV.population} souls · ${settV.dominantSpecies} · ${settV.specialization}`}
              {' · '}
              {settV.culture}
              {settV.leaderTitle && settV.ruler ? ` · ${settV.leaderTitle} ${settV.ruler}` : !settV.leaderTitle ? ' · free folk' : ''}
            </p>
          )}
          {settV?.polity && (
            <p className="polity">
              governed by the <em>{settV.polity.name}</em>
              {settV.polity.leaderName ? ` · led by ${settV.polity.leaderName}` : ''}
              {settV.polity.founderName ? ` · founded by ${settV.polity.founderName}` : ''}
              {settV.polity.leaderCount > 1 ? ` · ${settV.polity.leaderCount} leaders in its line` : ''}
              {` · treasury ${settV.polity.treasury}`}
            </p>
          )}
          {settV?.polity?.reasoning && (
            <div className="polity-reasoning">
              <p className="reasoning-line">
                <span className="muted">worldview:</span> {settV.polity.reasoning.worldview}
                {' · '}
                <span className="muted">intent:</span> <strong>{settV.polity.reasoning.intent}</strong>{' '}
                <span className="muted">({settV.polity.reasoning.score})</span>
              </p>
              <p className="reasoning-why muted">{settV.polity.reasoning.intentDescription}</p>
              <ul className="reasoning-factors">
                {settV.polity.reasoning.factors.map((f, i) => (
                  <li key={i}>
                    {f.group ? <span className="muted">{f.group}: </span> : null}
                    {f.label} <span className={f.value >= 0 ? 'pos' : 'neg'}>{f.value >= 0 ? `+${f.value}` : f.value}</span>
                  </li>
                ))}
              </ul>
              {settV.polity.reasoning.alternatives.length > 0 && (
                <p className="reasoning-alts muted">
                  also weighed: {settV.polity.reasoning.alternatives.map((a) => `${a.label} (${a.score})`).join(' · ')}
                </p>
              )}
              <details className="reasoning-perception">
                <summary className="muted">what it knows</summary>
                <ul>
                  {settV.polity.reasoning.perception.map((p, i) => (
                    <li key={i}>
                      {p.label}: {p.value} <span className="muted">({Math.round(p.confidence * 100)}% sure)</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          {settV?.polity?.operational && (
            <p className="polity-operational muted">
              {Object.entries(settV.polity.operational).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}
              {settV.polity.lastAction ? ` — last: ${settV.polity.lastAction.summary} (y${settV.polity.lastAction.year})` : ''}
            </p>
          )}
          {settV?.polity && (settV.polity.agreements.length > 0 || settV.polity.lastInteraction) && (
            <p className="polity-diplomacy muted">
              {settV.polity.agreements.length > 0
                ? `sworn: ${settV.polity.agreements.map((g) => `${g.kind === 'non_aggression' ? 'peace' : 'trade'} with ${g.with} (to y${g.untilYear})`).join(' · ')}`
                : ''}
              {settV.polity.lastInteraction
                ? `${settV.polity.agreements.length > 0 ? ' — ' : ''}${settV.polity.lastInteraction.summary} (y${settV.polity.lastInteraction.year})`
                : ''}
            </p>
          )}
          {settV?.patronDeity && (
            <p className="patron-deity">sacred to: <em>{settV.patronDeity.name}</em> · {settV.patronDeity.domain}</p>
          )}
          {settV?.creed && (settV.creed.reveres.length > 0 || settV.creed.abhors.length > 0) && (
            <p className="creed">
              {settV.creed.reveres.length > 0 && <>reveres <span className="creed-reveres">{settV.creed.reveres.join(' · ')}</span></>}
              {settV.creed.reveres.length > 0 && settV.creed.abhors.length > 0 && <span className="creed-sep"> · </span>}
              {settV.creed.abhors.length > 0 && <>abhors <span className="creed-abhors">{settV.creed.abhors.join(' · ')}</span></>}
            </p>
          )}
          {settV?.factionSplit && (
            <p className="faction-split">divided over <em>{settV.factionSplit.axis}</em>: <span className="faction-high">{settV.factionSplit.highName}</span> vs <span className="faction-low">{settV.factionSplit.lowName}</span></p>
          )}
          {settV?.civilWarYear !== undefined && (
            <p className="civil-war-tension">⚔ in civil conflict since year {settV.civilWarYear}</p>
          )}
          {settV && !settV.detailed && settV.ruinedYear === undefined && (
            <button className="play-inline" onClick={() => onFocus(settlementDetail.settlementId)}>
              ◉ turn your gaze here
            </button>
          )}
          <h4>Local history</h4>
          {settlementDetail.events.length === 0 ? (
            <p className="muted">Nothing recorded yet.</p>
          ) : (
            <ul className="rels">{settlementDetail.events.slice(0, 40).map(eventLine)}</ul>
          )}
        </div>
      )}

      {eventChain && (
        <div>
          <h3>Why did this happen?</h3>
          <div className="ev-root">
            <span className="ev-year">y{eventChain.root.year}</span> <EventText parts={eventChain.root.parts} onRef={onRef} />
          </div>
          {eventChain.ancestors.length === 0 ? (
            <p className="muted">This was an originating event — nothing caused it.</p>
          ) : (
            <>
              <h4>Caused by</h4>
              {/* the causal ancestry as a TREE — each cause indented under what it explains,
                  and itself clickable to re-root the "why?" there and walk further back. */}
              <ul className="cause-tree">
                {eventChain.ancestors.map((c) => (
                  <li key={c.event.id} className="cause-node" style={{ paddingLeft: `${(c.depth - 1) * 16}px` }}>
                    <span className="cause-arrow" aria-hidden>↳</span>
                    <span
                      className="ev-inspect"
                      onClick={() => onPickEvent(c.event.id)}
                      onKeyDown={(e) => onActivate(e, () => onPickEvent(c.event.id))}
                      role="button"
                      tabIndex={0}
                      title="trace this cause's causes"
                    >
                      <span className="ev-year">y{c.event.year}</span> <EventText parts={c.event.parts} onRef={onRef} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
