/**
 * The terrain/region map: pan-and-zoom over the world's substrate, with rivers,
 * roads, hostile marches and culture-coloured settlement nodes on top. All the
 * canvas painting and pointer gymnastics live here, out of the shell's way.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import type { PointerEvent as RPointerEvent, MouseEvent as RMouseEvent } from 'react';
import type { RegionMapView } from '../engine/model';
import { MAP_STYLES, type MapStyle } from '../content/mapstyles';
import { createSubstrate, SurfaceSubstrate, StarfieldSubstrate } from '../engine/substrate';
import { paintTerrain, paintStarfield, buildRoads, buildRivers, type TerrainLabel } from './terrain';
import { featureName } from '../engine/pack';
import { cultureColor, cultureName } from './common';

const MAP_VB = { x: -10, y: -12, w: 190, h: 193 };
// fallbacks so the backdrop always matches the WORLD's substrate, whatever skin is picked:
// a galaxy renders as a starfield, a surface world as terrain.
const STAR_FIELD = (MAP_STYLES.find((s) => s.style.kind === 'starfield')?.style as Extract<MapStyle, { kind: 'starfield' }> | undefined)?.field;
const SURF_THEME = (MAP_STYLES.find((s) => s.style.kind === 'surface')?.style as Extract<MapStyle, { kind: 'surface' }> | undefined)?.theme;

export function RegionMap({
  map,
  seed,
  focusedId,
  onInspect,
  busy,
}: {
  map: RegionMapView;
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
  // NB: this deliberately re-runs worldgen the worker already did. Trade-off: the substrate
  // is deterministic from the seed, so re-deriving it here on the presentation side is
  // cheaper and simpler than shipping the terrain rasters over the worker boundary.
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
