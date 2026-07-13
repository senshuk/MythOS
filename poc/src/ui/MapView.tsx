/**
 * The terrain/region map: pan-and-zoom over the world's substrate, with rivers,
 * roads, hostile marches and culture-coloured settlement nodes on top. All the
 * canvas painting and pointer gymnastics live here, out of the shell's way.
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { PointerEvent as RPointerEvent, MouseEvent as RMouseEvent } from 'react';
import type { RegionMapView, SettlementView, EventRef } from '../engine/model';
import { MAP_STYLES, type MapStyle } from '../content/mapstyles';
import { SurfaceSubstrate, StarfieldSubstrate } from '../engine/substrate';
import { substrateFor } from './substrateCache';
import { paintTerrain, paintStarfield, buildRoads, buildRivers, type TerrainLabel } from './terrain';
import { featureName } from '../engine/pack';
import { cultureColor, cultureName, usePersistentState } from './common';

/** The map's LENSES (Civ's overlay idiom): one question at a time — whose land is
 *  this (culture), whose gods (faith), where war smoulders, where trade flows. */
type Lens = 'culture' | 'faith' | 'war' | 'trade';
const LENSES: { id: Lens; label: string }[] = [
  { id: 'culture', label: 'Culture' },
  { id: 'faith', label: 'Faith' },
  { id: 'war', label: 'War' },
  { id: 'trade', label: 'Trade' },
];

/** A stable, distinct colour per deity — golden-angle hues so any count stays legible. */
const deityColor = (index: number) => `hsl(${Math.round((index * 137.5) % 360)} 52% 64%)`;

const MAP_VB = { x: -10, y: -12, w: 190, h: 193 };
// fallbacks so the backdrop always matches the WORLD's substrate, whatever skin is picked:
// a galaxy renders as a starfield, a surface world as terrain.
const STAR_FIELD = (MAP_STYLES.find((s) => s.style.kind === 'starfield')?.style as Extract<MapStyle, { kind: 'starfield' }> | undefined)?.field;
const SURF_THEME = (MAP_STYLES.find((s) => s.style.kind === 'surface')?.style as Extract<MapStyle, { kind: 'surface' }> | undefined)?.theme;

export function RegionMap({
  map,
  seed,
  focusedId,
  settlements,
  onInspect,
  onRef,
  onEnter,
  busy,
}: {
  map: RegionMapView;
  seed: number;
  focusedId: number;
  /** full settlement views, for the lenses that need more than the node (faith). */
  settlements: SettlementView[];
  onInspect: (id: number) => void;
  /** legend chips inspect what they name (a culture, a deity). */
  onRef?: (ref: EventRef) => void;
  /** double-click a settlement to enter its CLOSE VIEW (walk its streets). */
  onEnter?: (id: number) => void;
  busy: boolean;
}) {
  const [lens, setLens] = usePersistentState<Lens>('mythos.map.lens', 'culture');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const movedRef = useRef(false);
  const clickTimer = useRef<number | undefined>(undefined);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{ name: string; meaning?: string; sub: string; cx: number; cy: number } | null>(null);

  // the world IS its substrate (regenerated from the seed); the SUBSTRATE decides the
  // backdrop — a galaxy paints space, a surface world paints its biome terrain. There is
  // no "skin" to pick: how a world looks is what it physically is.
  // NB: this deliberately re-runs worldgen the worker already did. Trade-off: the substrate
  // is deterministic from the seed, so re-deriving it here on the presentation side is
  // cheaper and simpler than shipping the terrain rasters over the worker boundary.
  // Cached per seed so the close view shares the same instance (substrateCache).
  const sub = useMemo(() => substrateFor(seed), [seed]);
  const isStarfield = sub instanceof StarfieldSubstrate;

  // THE MAP COVERS THE BOX (the RimWorld/CK idiom — no letterbox). The box fills whatever
  // space the stage gives it; the zoom-1 view rect is MAP_VB cover-CROPPED to the box's
  // aspect (never extended — the geography grid ends just past MAP_VB, and its edge is not
  // a coastline). The cropped remainder pans back into view, even at minimum zoom.
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const r = wrap.getBoundingClientRect();
      setBoxSize((p) => (Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: r.width, h: r.height }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    ro?.observe(wrap);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  const baseVB = useMemo(() => {
    const A0 = MAP_VB.w / MAP_VB.h;
    const A = boxSize.w > 1 && boxSize.h > 1 ? boxSize.w / boxSize.h : A0;
    if (A >= A0) {
      // box is wider than the world: full width, a centred vertical slice
      const h = MAP_VB.w / A;
      return { x: MAP_VB.x, y: MAP_VB.y + (MAP_VB.h - h) / 2, w: MAP_VB.w, h };
    }
    // box is taller: full height, a centred horizontal slice
    const w = MAP_VB.h * A;
    return { x: MAP_VB.x + (MAP_VB.w - w) / 2, y: MAP_VB.y, w, h: MAP_VB.h };
  }, [boxSize]);

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

  // a SURFACE world re-paints the VISIBLE region at native resolution — but NOT on every
  // pan/zoom frame (that repainted the full canvas ~60×/s and made the map crawl). During
  // a gesture the already-painted bitmap just rides a cheap CSS transform; when the view
  // settles (~160ms quiet) one native-resolution repaint lands and the transform resets.
  const viewRef = useRef(view);
  viewRef.current = view;
  const paintedView = useRef<{ s: number; x: number; y: number } | null>(null);
  const repaintTimer = useRef<number | undefined>(undefined);

  const paintSurface = useCallback(() => {
    if (!(sub instanceof SurfaceSubstrate) || !SURF_THEME) return;
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.min(1600, Math.round(rect.width * dpr));
    c.height = Math.min(1600, Math.round(rect.height * dpr));
    // the world rectangle currently visible through the zoom/pan transform
    const v = viewRef.current;
    const vb = {
      x: baseVB.x + (-v.x / v.s) * (baseVB.w / rect.width),
      y: baseVB.y + (-v.y / v.s) * (baseVB.h / rect.height),
      w: baseVB.w / v.s,
      h: baseVB.h / v.s,
    };
    paintTerrain(c, sub.geography, vb, SURF_THEME, mapLabels);
    paintedView.current = { ...v };
    c.style.transform = '';
  }, [sub, mapLabels, baseVB]);

  useEffect(() => {
    if (!(sub instanceof SurfaceSubstrate)) return;
    const id = requestAnimationFrame(paintSurface);
    window.addEventListener('resize', paintSurface); // keep the bitmap at the box's native size
    // the stage's docks collapse without a window resize — watch the box itself
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paintSurface()) : undefined;
    if (wrapRef.current) ro?.observe(wrapRef.current);
    // repaint when the tab returns to the foreground (rAF is paused while hidden, which
    // would otherwise leave a stale/blank terrain until the next view change)
    const onVisible = () => document.visibilityState === 'visible' && paintSurface();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', paintSurface);
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [seed, sub, paintSurface]);

  // pan/zoom: slide the painted bitmap now, repaint at native resolution once settled
  useEffect(() => {
    if (!(sub instanceof SurfaceSubstrate)) return;
    const c = canvasRef.current;
    const p = paintedView.current;
    if (c && p && (p.s !== view.s || p.x !== view.x || p.y !== view.y)) {
      // T such that T∘painted = current: scale a = s/pₛ, then translate the residue
      const a = view.s / p.s;
      c.style.transformOrigin = '0 0';
      c.style.transform = `translate(${view.x - a * p.x}px, ${view.y - a * p.y}px) scale(${a})`;
    }
    window.clearTimeout(repaintTimer.current);
    repaintTimer.current = window.setTimeout(paintSurface, 160);
    return () => window.clearTimeout(repaintTimer.current);
  }, [view, sub, paintSurface]);

  // reset the explored view when the world or skin changes
  useEffect(() => setView({ s: 1, x: 0, y: 0 }), [seed]);

  // Clamp the pan so the WORLD's edge never pulls inside the box. A world point w maps to
  // px = (w − baseVB.x)·(rect.w / baseVB.w)·s + v.x, so bounding px(MAP_VB edges) outside
  // the box gives the pan range — which, because baseVB is a crop, is non-zero even at
  // zoom 1 along the cropped axis (that's how the cropped remainder is reached).
  const clampView = (v: { s: number; x: number; y: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return v;
    const kx = (r.width / baseVB.w) * v.s;
    const ky = (r.height / baseVB.h) * v.s;
    const xMax = -(MAP_VB.x - baseVB.x) * kx;
    const xMin = r.width - (MAP_VB.x + MAP_VB.w - baseVB.x) * kx;
    const yMax = -(MAP_VB.y - baseVB.y) * ky;
    const yMin = r.height - (MAP_VB.y + MAP_VB.h - baseVB.y) * ky;
    return { s: v.s, x: Math.min(xMax, Math.max(xMin, v.x)), y: Math.min(yMax, Math.max(yMin, v.y)) };
  };

  // a box resize (dock toggle, window resize) changes the crop — keep the view in bounds
  useEffect(() => {
    setView((v) => clampView(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseVB]);
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
        // keep dragging smoothly past the edge. Guarded: capture THROWS if the pointer is
        // no longer active (released between events, synthetic pointers) — a failed grab
        // must not abort the pan itself.
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* pan proceeds uncaptured */
        }
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
  const radius = (pop: number) => 1.0 + 2.1 * Math.sqrt(pop / maxPop);

  // the FAITH lens joins each node to its settlement's patron deity; deity colours are
  // assigned in a stable order so the same god keeps its hue across worlds and lenses.
  const settById = useMemo(() => new Map(settlements.map((s) => [s.id, s])), [settlements]);
  const deities = useMemo(() => {
    const seen = new Map<string, string>(); // id -> name
    for (const s of settlements) if (s.patronDeity && !seen.has(s.patronDeity.id)) seen.set(s.patronDeity.id, s.patronDeity.name);
    return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, name], i) => ({ id, name, color: deityColor(i) }));
  }, [settlements]);
  const deityColorById = useMemo(() => new Map(deities.map((d) => [d.id, d.color])), [deities]);

  /** a node's fill under the active lens */
  const nodeColor = (nId: number, cultureId: string): string => {
    if (lens === 'faith') {
      const pd = settById.get(nId)?.patronDeity;
      return (pd && deityColorById.get(pd.id)) || '#8a8f9e';
    }
    if (lens === 'war' || lens === 'trade') return '#767c8a'; // the lens's lines carry the story
    return cultureColor(cultureId);
  };

  const maxTrade = Math.max(1, ...map.edges.map((e) => e.tradeVolume));
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
        <svg className="map" viewBox={`${baseVB.x} ${baseVB.y} ${baseVB.w} ${baseVB.h}`} preserveAspectRatio="xMidYMid slice">
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
              the valleys, sea lanes cross the water (design: RimWorld draws world roads).
              Under the war/trade lenses they fade so the lens's own lines carry the story. */}
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
              opacity={(lens === 'war' || lens === 'trade' ? 0.4 : 1) * (rd.kind === 'sea' ? 0.32 : 0.5)}
            />
          ))}
          {/* TRADE lens: the flows themselves, width ∝ volume */}
          {lens === 'trade' &&
            map.edges.filter((e) => e.tradeVolume > 0).map((e, i) => {
              const a = nodeById.get(e.a)!;
              const b = nodeById.get(e.b)!;
              return (
                <line
                  key={`t${i}`}
                  className="edge trade"
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="var(--jade)"
                  strokeWidth={0.35 + 1.3 * (e.tradeVolume / maxTrade)}
                  opacity={0.75}
                />
              );
            })}
          {/* hostile borders stay straight — a contested march, not a road. The war lens
              turns them up; the trade lens clears them out of the way. */}
          {lens !== 'trade' &&
            map.edges.filter((e) => e.relation < -20).map((e, i) => {
              const a = nodeById.get(e.a)!;
              const b = nodeById.get(e.b)!;
              return (
                <line
                  key={`h${i}`}
                  className="edge hostile"
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="var(--rose)"
                  strokeWidth={lens === 'war' ? 0.9 : 0.5}
                  strokeDasharray="1 1"
                  opacity={lens === 'war' ? 0.95 : 0.7}
                />
              );
            })}
          {/* nodes: coloured by the active lens, sized by population; hover for a glance, click for its story */}
          {map.nodes.map((n) => {
            const focused = n.id === focusedId;
            const r = n.ruined ? 1.3 : radius(n.population);
            const color = nodeColor(n.id, n.cultureId);
            const faithNote = lens === 'faith' ? settById.get(n.id)?.patronDeity?.name : undefined;
            const sub = n.ruined
              ? 'a ruin'
              : `${cultureName(n.cultureId)}${faithNote ? ` · sacred to ${faithNote}` : ''} · ${n.population} souls`;
            // set once on enter (a per-move setState re-rendered the whole SVG while roaming)
            const enter = (e: RMouseEvent) => setHover({ name: n.name, meaning: n.nameMeaning, sub, cx: e.clientX, cy: e.clientY });
            return (
              <g
                key={n.id}
                className={busy ? 'mnode' : 'mnode clickable'}
                onClick={() => {
                  if (movedRef.current) return;
                  window.clearTimeout(clickTimer.current);
                  if (!busy) clickTimer.current = window.setTimeout(() => onInspect(n.id), 180);
                }}
                onDoubleClick={() => {
                  if (movedRef.current || busy) return;
                  window.clearTimeout(clickTimer.current);
                  onEnter?.(n.id);
                }}
                onMouseEnter={enter}
                onMouseLeave={() => setHover(null)}
              >
                {focused && <circle className="focus-ring" cx={n.x} cy={n.y} r={r + 1.3} fill="none" stroke="var(--gold)" strokeWidth={0.6} />}
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

      {/* LENSES — one question at a time (Civ's overlay idiom) */}
      <div className="map-lenses seg" role="group" aria-label="map lens">
        {LENSES.map((l) => (
          <button key={l.id} className={lens === l.id ? 'on' : ''} onClick={() => setLens(l.id)}>
            {l.label}
          </button>
        ))}
      </div>

      {/* the LEGEND adapts to the lens; its chips inspect what they name */}
      <div className="map-legend">
        {lens === 'culture' &&
          [...new Set(map.nodes.map((n) => n.cultureId))].map((id) => (
            <button key={id} className="legend-chip" onClick={() => onRef?.({ kind: 'culture', id })} disabled={!onRef}>
              <i className="cdot" style={{ background: cultureColor(id) }} /> {cultureName(id)}
            </button>
          ))}
        {lens === 'faith' &&
          deities.map((d) => (
            <button key={d.id} className="legend-chip" onClick={() => onRef?.({ kind: 'deity', id: d.id })} disabled={!onRef}>
              <i className="cdot" style={{ background: d.color }} /> {d.name}
            </button>
          ))}
        {lens === 'war' && (
          <span className="legend-chip static"><i className="sw bad" /> a contested march</span>
        )}
        {lens === 'trade' && (
          <span className="legend-chip static"><i className="sw good" /> trade, thick with volume</span>
        )}
        <span className="legend-chip static">● size = population</span>
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
          {onEnter && <span className="tip-hint">click its tale · double-click to walk its streets</span>}
        </div>
      )}
    </div>
  );
}
