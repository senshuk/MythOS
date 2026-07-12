/**
 * THE CLOSE VIEW (design/24, phase L1 + §8): one settlement four hundred times closer —
 * the same deterministic world. Terrain is the real Geography sampled over a ~11-unit
 * frame; the view ZOOMS AND PANS, re-painting the visible sub-frame at native resolution
 * (the world map's decoupled-repaint pattern) so nearing the ground reveals real detail
 * instead of magnifying blur. The town plan is the pack's LocalGenStep pipeline
 * (content/localmap.ts) drawn as an SVG overlay that rides the same transform.
 * Pure presentation: nothing here is stored, and the sim never sees it.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { RegionMapView, SettlementView, EventRef, EventView, HouseholdView } from '../engine/model';
import { SurfaceSubstrate } from '../engine/substrate';
import { substrateFor } from './substrateCache';
import { MAP_STYLES, type MapStyle } from '../content/mapstyles';
import { buildLocalPlan, type LocalPlanFacts, type PlanItem } from '../content/localmap';
import { ARCH_BY_ID } from '../content/architecture';
import { paintTerrain, paintTerrainOverlay, buildRoads, buildLocalRivers, type TerrainLabel, type LocalRiver, type ViewBox, type GeoFields } from './terrain';
import type { TerrainPaintResponse } from './terrainWorker';
// lazy — three.js (~300 KB gzip) loads only when the 3D view is opened, off the initial bundle
const LocalTerrain3DThree = lazy(() => import('./LocalTerrain3DThree').then((m) => ({ default: m.LocalTerrain3DThree })));
import { featureName } from '../engine/pack';
import { Icon } from './icons';

const SURF_THEME = (MAP_STYLES.find((s) => s.style.kind === 'surface')?.style as Extract<MapStyle, { kind: 'surface' }> | undefined)?.theme;
const FRAME = 11; // world units the frame's short side spans (~a town and its hinterland)

export function LocalMapView({
  settlement,
  map,
  seed,
  currentYear,
  chronicle,
  households,
  venues,
  onExit,
  onRef,
  onPickEvent,
}: {
  settlement: SettlementView;
  map: RegionMapView;
  seed: number;
  currentYear: number;
  /** the settlement's notable history (oldest first) — feeds the HISTORY MARKS. */
  chronicle?: EventView[];
  /** who lives under which roof — present only for the lived-in-full settlement (L2). */
  households?: HouseholdView[];
  /** the settlement's public venues (L4) — the drawn buildings link to them. */
  venues?: { id: number; name: string; meaning?: string; type: string }[];
  onExit: () => void;
  onRef: (ref: EventRef) => void;
  /** a history mark traces the event it remembers (the burned quarter answers "why?"). */
  onPickEvent: (id: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ text: string; cx: number; cy: number } | null>(null);
  const [show3d, setShow3d] = useState(false); // the 3D terrain view (three.js, design/24 §8)
  const show3dRef = useRef(show3d); // for the once-attached wheel listener's closure
  show3dRef.current = show3d;

  const sub = useMemo(() => substrateFor(seed), [seed]);
  const node = map.nodes.find((n) => n.id === settlement.id);

  // the frame: aspect-matched to the box (same cover idiom as the world map), centred
  // on the settlement, short side = FRAME world units
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
    return () => ro?.disconnect();
  }, []);
  // keyed by VALUES, not the node object (a streamed snapshot re-creates the views
  // every year — the frame must hold still or the terrain canvas repaints per tick)
  const nx = node?.x ?? 0;
  const ny = node?.y ?? 0;
  const frame = useMemo(() => {
    const A = boxSize.w > 1 && boxSize.h > 1 ? boxSize.w / boxSize.h : 1;
    const w = A >= 1 ? FRAME * A : FRAME;
    const h = A >= 1 ? FRAME : FRAME / A;
    return { x: nx - w / 2, y: ny - h / 2, w, h };
  }, [nx, ny, boxSize]);

  // ZOOM/PAN over the close view (design/24 §8): the terrain canvas RE-PAINTS the visible
  // sub-frame at native resolution as you zoom, so nearing the ground reveals real detail
  // rather than magnifying a fixed blur — the world map's proven decoupled-repaint pattern.
  // `frame` is the base (s=1) rect; `view` is a screen-space transform over it.
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const paintedView = useRef<{ s: number; x: number; y: number } | null>(null);
  const repaintTimer = useRef<number | undefined>(undefined);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());

  // The close-view terrain paint (dozens of noise octaves per pixel × millions of pixels, ~2s)
  // runs in a Web Worker so it never freezes the UI. The main thread only blits the returned
  // buffer + draws labels. Latest request wins; the canvas rides its CSS transform until the
  // fresh buffer lands. Falls back to a synchronous paint if workers are unavailable.
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const pendingRef = useRef(new Map<number, { vb: ViewBox; v: { s: number; x: number; y: number }; W: number; H: number }>());
  const labelsRef = useRef<TerrainLabel[]>([]);
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null; // fallback to synchronous paint
    }
    workerRef.current = worker;
    const pending = pendingRef.current;
    if (worker) {
      worker.onmessage = (e: MessageEvent<TerrainPaintResponse>) => {
        const { id, buf, W, H } = e.data;
        const rec = pending.get(id);
        pending.delete(id);
        if (!rec || id !== reqIdRef.current) return; // superseded by a newer request — drop it
        const c = canvasRef.current;
        if (!c || !SURF_THEME) return;
        c.width = W;
        c.height = H; // resize (blanks) then blit in the same frame — no visible flash
        const ctx = c.getContext('2d');
        if (!ctx) return;
        paintTerrainOverlay(ctx, buf, rec.vb, SURF_THEME, W, H, labelsRef.current);
        paintedView.current = { ...rec.v };
        c.style.transform = '';
      };
    }
    return () => { worker?.terminate(); workerRef.current = null; pending.clear(); };
  }, []);
  const pinchDist = useRef(0);
  const moved = useRef(false);
  // a new settlement returns to the composed vista
  useEffect(() => { setView({ s: 1, x: 0, y: 0 }); }, [settlement.id]);

  // road entries: the directions the settlement's real graph-neighbours lie toward —
  // the world's roads and the town's streets meet at the frame's edge (continuity).
  const roadEntries = useMemo(() => {
    if (!node) return [];
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const angles: number[] = [];
    for (const e of map.edges) {
      if (e.relation < -20) continue; // a hostile march has no road
      const other = e.a === settlement.id ? byId.get(e.b) : e.b === settlement.id ? byId.get(e.a) : undefined;
      if (other) angles.push(Math.atan2(other.y - node.y, other.x - node.x));
    }
    return angles;
  }, [map, node, settlement.id]);

  // the deterministic town plan — same facts, same town, every time
  const plan = useMemo(() => {
    if (!(sub instanceof SurfaceSubstrate) || !node) return null;
    const facts: LocalPlanFacts = {
      seed,
      settlement,
      pos: { x: node.x, y: node.y },
      roadEntries,
      geo: sub.geography,
      currentYear,
      chronicle,
      households,
      venues,
    };
    return buildLocalPlan(facts);
  }, [sub, node, seed, settlement, roadEntries, currentYear, chronicle, households, venues]);

  // the world's ROADS pass through the frame (SVG clips them to the viewBox)
  const roads = useMemo(
    () => (sub instanceof SurfaceSubstrate ? buildRoads(sub.geography, map.nodes, map.edges) : []),
    [sub, map.nodes, map.edges],
  );

  // the RIVER CURRENT in the frame — an animated ripple riding the real drainage course,
  // its speed set by the river's discharge (a torrent hurries, a brook drifts)
  const rivers = useMemo<LocalRiver[]>(
    () => (sub instanceof SurfaceSubstrate ? buildLocalRivers(sub.geography, frame) : []),
    [sub, frame],
  );

  // nearby named features letter themselves (paintTerrain skips out-of-frame ones)
  const labels = useMemo<TerrainLabel[]>(
    () =>
      sub instanceof SurfaceSubstrate
        ? sub.geography.features.map((f) => ({ x: f.center.x, y: f.center.y, text: featureName(seed, f).name, kind: f.kind }))
        : [],
    [sub, seed],
  );
  labelsRef.current = labels; // the worker's onmessage reads the latest labels via this ref

  // paint the VISIBLE sub-frame (base frame under the zoom/pan transform) at native
  // resolution — so zooming in re-resolves the terrain crisply instead of stretching a blur.
  const paintClose = useCallback(() => {
    if (!(sub instanceof SurfaceSubstrate) || !SURF_THEME) return;
    if (show3dRef.current) return; // the 3D overlay is up — never run the heavy 2D repaint under it (any path: settle, initial rAF, ResizeObserver, visibilitychange)
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 2) return;
    // back the canvas at (up to) the displayed pixel count so it is never upscaled into blur.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // back the canvas at (up to) the displayed pixel count so it is never upscaled into blur.
    const W = Math.min(2048, Math.round(rect.width * dpr));
    const H = Math.min(2048, Math.round(rect.height * dpr));
    const v = viewRef.current;
    const vb = {
      x: frame.x + (-v.x / v.s) * (frame.w / rect.width),
      y: frame.y + (-v.y / v.s) * (frame.h / rect.height),
      w: frame.w / v.s,
      h: frame.h / v.s,
    };
    const g = sub.geography;
    const worker = workerRef.current;
    if (worker) {
      // Offload the heavy pixel loop. The canvas is NOT resized here (that would blank it) —
      // it keeps riding its CSS transform until the buffer returns, then onmessage resizes and
      // blits in one frame. Newer requests supersede older ones (reqId), so a fast zoom doesn't
      // queue a backlog of stale paints.
      const id = ++reqIdRef.current;
      pendingRef.current.set(id, { vb, v: { ...v }, W, H });
      const geo: GeoFields = {
        size: g.size, elevation: g.elevation, moisture: g.moisture, temperature: g.temperature,
        fertility: g.fertility, water: g.water, hilliness: g.hilliness, seaLevel: g.seaLevel,
      };
      worker.postMessage({ id, geo, vb, theme: SURF_THEME, W, H });
    } else {
      c.width = W;
      c.height = H;
      paintTerrain(c, g, vb, SURF_THEME, labels);
      paintedView.current = { ...v };
      c.style.transform = '';
    }
  }, [sub, frame, labels]);

  useEffect(() => {
    if (!(sub instanceof SurfaceSubstrate)) return;
    const id = requestAnimationFrame(paintClose);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paintClose()) : undefined;
    if (wrapRef.current) ro?.observe(wrapRef.current);
    const onVisible = () => document.visibilityState === 'visible' && paintClose();
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelAnimationFrame(id); ro?.disconnect(); document.removeEventListener('visibilitychange', onVisible); };
  }, [sub, paintClose]);

  // during a gesture the painted bitmap just rides a cheap CSS transform; when the view
  // settles (~160ms quiet) one native-resolution repaint lands and the transform resets.
  useEffect(() => {
    // While the 3D overlay is up it owns the view — skip the costly 2048² repaint entirely
    // (it would block the shared main thread for seconds and freeze the 3D render). When the
    // overlay closes, show3d flips and this effect re-runs to repaint the 2D map cleanly.
    if (!(sub instanceof SurfaceSubstrate) || show3d) return;
    const c = canvasRef.current;
    const p = paintedView.current;
    // already painted at this exact view (e.g. returning from the 3D overlay, which can't
    // change the 2D view) — the canvas is correct, so skip the costly repaint entirely.
    if (p && p.s === view.s && p.x === view.x && p.y === view.y) return;
    if (c && p) {
      const a = view.s / p.s;
      c.style.transformOrigin = '0 0';
      c.style.transform = `translate(${view.x - a * p.x}px, ${view.y - a * p.y}px) scale(${a})`;
    }
    window.clearTimeout(repaintTimer.current);
    repaintTimer.current = window.setTimeout(paintClose, 160);
    return () => window.clearTimeout(repaintTimer.current);
  }, [view, sub, paintClose, show3d]);

  // keep the base frame filling the box: at s=1 there is no pan; zoomed in, you may pan
  // within the frame but never pull its edge inside the box.
  const clampView = (v: { s: number; x: number; y: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || v.s <= 1) return { s: Math.max(1, v.s), x: 0, y: 0 };
    const xMin = r.width - r.width * v.s;
    const yMin = r.height - r.height * v.s;
    return { s: v.s, x: Math.min(0, Math.max(xMin, v.x)), y: Math.min(0, Math.max(yMin, v.y)) };
  };
  const zoomAt = (cx: number, cy: number, factor: number) =>
    setView((v) => {
      const ns = Math.min(8, Math.max(1, v.s * factor));
      return clampView({ s: ns, x: cx - ((cx - v.x) / v.s) * ns, y: cy - ((cy - v.y) / v.s) * ns });
    });
  const zoomCenter = (factor: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) zoomAt(r.width / 2, r.height / 2, factor);
  };

  // wheel zoom (non-passive so the page never scrolls under it)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (show3dRef.current) return; // the 3D overlay's OrbitControls owns the wheel; don't also drive the 2D zoom
      const r = wrap.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: RPointerEvent) => {
    if (show3d) return; // the 3D overlay handles its own orbit/pan
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    pinchDist.current = 0;
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (show3d) return;
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
      moved.current = true;
    } else {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (viewRef.current.s > 1 && Math.abs(dx) + Math.abs(dy) > 2) {
        moved.current = true;
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* pan proceeds uncaptured */ }
      }
      if (moved.current) setView((v) => clampView({ s: v.s, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onPointerUp = (e: RPointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchDist.current = 0;
  };

  if (!node || !(sub instanceof SurfaceSubstrate)) {
    // a world without a walkable surface (a starfield) has no close view — pack's call
    return (
      <div className="map-wrap local-wrap">
        <div className="local-head">
          <button className="local-back" onClick={onExit}><Icon name="back" /> back to the world</button>
        </div>
        <p className="local-none muted">This world offers no closer view.</p>
      </div>
    );
  }

  const show = (text: string) => (e: { clientX: number; clientY: number }) => setTip({ text, cx: e.clientX, cy: e.clientY });
  const hide = () => setTip(null);

  return (
    <div
      ref={wrapRef}
      className="map-wrap local-wrap"
      style={{ cursor: view.s > 1 ? 'grab' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} className="map-terrain" />
      <div className="map-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0' }}>
      <svg className="map" viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} preserveAspectRatio="xMidYMid slice">
        {/* the world's roads run through — the same lines you saw from orbit */}
        {roads.map((rd, i) => (
          <path
            key={`rd${i}`}
            d={rd.d}
            fill="none"
            stroke={rd.kind === 'sea' ? 'var(--cyan)' : 'var(--neutral)'}
            strokeWidth={Math.min(0.13, rd.width * 0.35)}
            strokeDasharray={rd.kind === 'sea' ? '0.22 0.3' : undefined}
            strokeLinecap="round"
            opacity={rd.kind === 'sea' ? 0.3 : 0.45}
          />
        ))}
        {/* the river's current — an animated ripple on the water the canvas painted,
            flowing downstream; a torrent hurries, a slow reach barely drifts */}
        {rivers.map((rv, i) => {
          // a real watercourse, not a dashed thread: a soft wet BANK, a solid water BODY, and a
          // subtle flowing SHEEN on top (animated downstream at the reach's own speed).
          const w = Math.max(0.055, rv.width);
          return (
            <g key={`rv${i}`}>
              <path className="lr-bank" d={rv.d} strokeWidth={w * 2.1} />
              <path className="lr-body" d={rv.d} strokeWidth={w * 1.25} />
              <path className="lr-sheen" d={rv.d} strokeWidth={Math.max(0.02, w * 0.5)}
                style={{ animationDuration: `${(9 - rv.speed * 6.6).toFixed(2)}s` }} />
            </g>
          );
        })}
        {plan && plan.items.map((it, i) => <PlanGlyph key={i} it={it} show={show} hide={hide} onRef={onRef} onPickEvent={onPickEvent} />)}
      </svg>
      </div>

      {/* zoom the streets — scroll or pinch, or these; each zoom RE-PAINTS at native res */}
      <div className="map-ctl">
        <button onClick={() => zoomCenter(1.4)} title="zoom in" aria-label="zoom in">+</button>
        <button onClick={() => zoomCenter(1 / 1.4)} title="zoom out" aria-label="zoom out">−</button>
        <button onClick={() => setView({ s: 1, x: 0, y: 0 })} title="reset view" aria-label="reset view">⤢</button>
        <button className="ctl-3d" onClick={() => setShow3d(true)} title="3D terrain" aria-label="3D terrain">3D</button>
      </div>

      {/* the 3D terrain view — a three.js scene of the same ground (design/24 §8), lazy-loaded */}
      {show3d && node && (
        <Suspense fallback={<div className="local-3d"><p className="local-3d-hint muted">loading the 3D view…</p></div>}>
          <LocalTerrain3DThree geo={sub.geography} plan={plan} cx={node.x} cy={node.y} span={16} seed={seed} onExit={() => setShow3d(false)} />
        </Suspense>
      )}

      {/* who and where — the breadcrumb back to the world */}
      <div className="local-head">
        <button className="local-back" onClick={onExit} title="back to the world (Esc)">
          <Icon name="back" /> the world
        </button>
        <span className="local-title">
          {settlement.name}
          {settlement.nameMeaning && <em className="local-gloss"> · “{settlement.nameMeaning}”</em>}
        </span>
      </div>
      <div className="local-foot">
        {settlement.ruinedYear !== undefined ? (
          <span className="ruin">a ruin — fell y{settlement.ruinedYear}, {currentYear - settlement.ruinedYear} years silent</span>
        ) : (
          <span>
            {settlement.population.toLocaleString()} souls · {settlement.culture} · {settlement.specialization}
            {settlement.detailed
              ? households && households.length > 0
                ? ` · lived in full — hover a lit roof to meet its household`
                : ' · lived in full'
              : ' · known by chronicle and rumour'}
          </span>
        )}
      </div>

      {tip && (
        <div className="map-tip" style={{ left: tip.cx + 14, top: tip.cy + 14 }}>
          <span className="muted">{tip.text}</span>
        </div>
      )}
    </div>
  );
}

/** One plan item as SVG — colours/styling live in CSS classes (Atlas language). */
function PlanGlyph({
  it,
  show,
  hide,
  onRef,
  onPickEvent,
}: {
  it: PlanItem;
  show: (text: string) => (e: { clientX: number; clientY: number }) => void;
  hide: () => void;
  onRef: (ref: EventRef) => void;
  onPickEvent: (id: number) => void;
}) {
  if (it.kind === 'street' || it.kind === 'pier' || it.kind === 'wall' || it.kind === 'barricade' || it.kind === 'packed' || it.kind === 'bridge') {
    const d = it.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ');
    return (
      <path
        className={`plan-${it.kind}`}
        d={d}
        fill="none"
        strokeWidth={it.width}
        strokeLinecap={it.kind === 'bridge' ? 'butt' : 'round'}
        strokeLinejoin="round"
        onMouseEnter={it.label ? show(it.label) : undefined}
        onMouseLeave={it.label ? hide : undefined}
      />
    );
  }
  if (it.kind === 'tree') {
    const r = it.r, fill = it.tone;
    // biome-appropriate silhouette (design/28 §5) — pointed conifer, round broadleaf,
    // fronded palm, low scrub, a tuft of reeds. Orchard trees read like tidy broadleaf.
    if (it.form === 'conifer') {
      const d = `M ${it.x} ${it.y - r * 1.5} L ${it.x - r} ${it.y + r * 0.7} L ${it.x + r} ${it.y + r * 0.7} Z`;
      return <path className="plan-tree" d={d} style={fill ? { fill } : undefined} />;
    }
    if (it.form === 'palm') {
      // a small crown with a few radiating fronds
      const fronds = [0, 1, 2, 3, 4].map((k) => {
        const a = -Math.PI / 2 + (k - 2) * 0.7;
        return `M ${it.x} ${it.y} L ${it.x + Math.cos(a) * r * 1.6} ${it.y + Math.sin(a) * r * 1.6}`;
      }).join(' ');
      return (
        <g className="plan-tree-palm">
          <path d={fronds} style={fill ? { stroke: fill } : undefined} />
          <circle cx={it.x} cy={it.y} r={r * 0.45} style={fill ? { fill } : undefined} />
        </g>
      );
    }
    if (it.form === 'scrub') {
      return <ellipse className="plan-tree" cx={it.x} cy={it.y} rx={r} ry={r * 0.6} style={fill ? { fill } : undefined} />;
    }
    if (it.form === 'reed') {
      const blades = [-0.4, 0, 0.4].map((o) => `M ${it.x + o * r} ${it.y + r} L ${it.x + o * r * 1.6} ${it.y - r * 1.8}`).join(' ');
      return <path className="plan-reed" d={blades} style={fill ? { stroke: fill } : undefined} />;
    }
    return <circle className="plan-tree" cx={it.x} cy={it.y} r={r} style={fill ? { fill } : undefined} />;
  }
  if (it.kind === 'person') {
    // a tiny figure — a head over a cloaked body — so the town reads as peopled (design/27 §3).
    // Size varies by role and a per-figure hash (no two folk exactly alike); the body faces
    // its `facing` so a crowd turns toward the square / a mourner toward the pyre.
    const act = it.ref ? () => onRef(it.ref!) : undefined;
    const hsh = Math.abs(Math.sin(it.x * 73.13 + it.y * 19.71) * 43758.5);
    const jit = hsh - Math.floor(hsh); // 0..1 deterministic
    const base = it.tone === 'child' ? 0.014 : it.tone === 'notable' ? 0.023 : 0.019;
    const r = base * (0.9 + jit * 0.28);
    // a cloak: rounded shoulders flaring to a hem, drawn "downwards" (toward +y = behind the facing)
    const body = `M ${-r * 0.82} ${r * 0.2} Q ${-r * 1.02} ${r * 1.75} ${-r * 0.34} ${r * 2.05} L ${r * 0.34} ${r * 2.05} Q ${r * 1.02} ${r * 1.75} ${r * 0.82} ${r * 0.2} Q 0 ${-r * 0.32} ${-r * 0.82} ${r * 0.2} Z`;
    return (
      <g
        className={`plan-person tone-${it.tone}`}
        transform={`translate(${it.x} ${it.y}) rotate(${(it.facing * 180) / Math.PI + jit * 30 - 15})`}
        onMouseEnter={it.label ? show(it.label) : undefined}
        onMouseLeave={it.label ? hide : undefined}
        onClick={act}
        role={act ? 'button' : undefined}
        tabIndex={act ? 0 : undefined}
        onKeyDown={act ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } } : undefined}
      >
        <path className="plan-person-body" d={body} />
        <circle className="plan-person-head" cx={0} cy={-r * 0.55} r={r} />
      </g>
    );
  }
  if (it.kind === 'field' || it.kind === 'terrace' || it.kind === 'rubble' || it.kind === 'square' || it.kind === 'scorch') {
    // a mark traces its event; the square inspects its venue (L4)
    const act = it.eventId !== undefined ? () => onPickEvent(it.eventId!) : it.ref ? () => onRef(it.ref!) : undefined;
    return (
      <g
        transform={`translate(${it.x} ${it.y}) rotate(${(it.rot * 180) / Math.PI})`}
        onMouseEnter={it.label ? show(it.label) : undefined}
        onMouseLeave={it.label ? hide : undefined}
        onClick={act}
        role={act ? 'button' : undefined}
        tabIndex={act ? 0 : undefined}
        onKeyDown={act ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } } : undefined}
        className={act ? 'plan-mark' : undefined}
      >
        {it.kind === 'scorch' ? (
          // a burn scar heals with the years — ellipse, not architecture
          <ellipse className="plan-scorch" rx={it.w / 2} ry={it.h / 2} style={{ opacity: 0.75 * (1 - (it.age ?? 0) * 0.85) }} />
        ) : (
          <rect className={`plan-${it.kind}${it.kind === 'field' && it.crop ? ` crop-${it.crop}` : ''}`} x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} />
        )}
        {it.kind === 'field' && it.crop === 'vine' ? (
          // vineyard — rows of stakes ACROSS the plot (verticals), not sown furrows
          <>
            {[-0.3, -0.1, 0.1, 0.3].map((f, k) => (
              <line key={k} className="plan-vinerow" x1={it.w * f} y1={-it.h / 2 + 0.03} x2={it.w * f} y2={it.h / 2 - 0.03} />
            ))}
          </>
        ) : it.kind === 'field' && it.crop === 'paddy' ? (
          // paddy — level water bunds, a still sheen
          <>
            <line className="plan-bund" x1={-it.w / 2 + 0.03} y1={0} x2={it.w / 2 - 0.03} y2={0} />
            <rect className="plan-paddy-water" x={-it.w / 2 + 0.03} y={-it.h / 2 + 0.03} width={it.w - 0.06} height={it.h - 0.06} />
          </>
        ) : it.kind === 'field' ? (
          // furrow lines — the strip-plot look (grain / generic)
          <>
            <line className="plan-furrow" x1={-it.w / 2 + 0.04} y1={-it.h / 6} x2={it.w / 2 - 0.04} y2={-it.h / 6} />
            <line className="plan-furrow" x1={-it.w / 2 + 0.04} y1={it.h / 6} x2={it.w / 2 - 0.04} y2={it.h / 6} />
          </>
        ) : null}
        {it.kind === 'terrace' && (
          // stepped contour banks — fields cut into a slope
          <>
            <line className="plan-terrace-bank" x1={-it.w / 2} y1={-it.h / 4} x2={it.w / 2} y2={-it.h / 4} />
            <line className="plan-terrace-bank" x1={-it.w / 2} y1={0} x2={it.w / 2} y2={0} />
            <line className="plan-terrace-bank" x1={-it.w / 2} y1={it.h / 4} x2={it.w / 2} y2={it.h / 4} />
          </>
        )}
      </g>
    );
  }
  if (it.kind !== 'building') return null; // exhaustiveness guard — narrows for TS too
  const cls = `plan-building tone-${it.tone} role-${it.role}${it.inhabited ? ' inhabited' : ''}${it.era ? ` era-${it.era}` : ''}${it.shape ? ` shape-${it.shape}` : ''}${it.derelict ? ' derelict' : ''}`;
  // ARCHITECTURE (design/28 §3): the culture's style tints the roof and shapes its silhouette
  const st = it.arch ? ARCH_BY_ID[it.arch] : undefined;
  const roofFill = st ? `rgb(${Math.round(st.roof[0] * 255)}, ${Math.round(st.roof[1] * 255)}, ${Math.round(st.roof[2] * 255)})` : undefined;
  const hw = it.w / 2, hh = it.h / 2;
  // a history mark traces its event; a civic building inspects its subject
  const act = it.eventId !== undefined ? () => onPickEvent(it.eventId!) : it.ref ? () => onRef(it.ref!) : undefined;
  return (
    <g
      className={cls}
      transform={`translate(${it.x} ${it.y}) rotate(${(it.rot * 180) / Math.PI})`}
      onMouseEnter={show(it.label)}
      onMouseLeave={hide}
      onClick={act}
      role={act ? 'button' : undefined}
      tabIndex={act ? 0 : undefined}
      onKeyDown={act ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } } : undefined}
    >
      {it.role === 'grave' ? (
        // a headstone: a small rounded marker
        <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} rx={it.w / 2.2} />
      ) : it.role === 'watchtower' ? (
        // a watchtower: a square keep with a crenellated cap
        <>
          <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} rx={0.008} />
          <line x1={-it.w / 2} y1={-it.h / 2} x2={it.w / 2} y2={-it.h / 2} className="plan-crenel" />
        </>
      ) : it.role === 'scaffold' ? (
        // a house rising: a bare timber frame (posts + a cross-brace)
        <>
          <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} fill="none" className="plan-frame" />
          <line x1={-it.w / 2} y1={-it.h / 2} x2={it.w / 2} y2={it.h / 2} className="plan-frame" />
          <line x1={-it.w / 2} y1={it.h / 2} x2={it.w / 2} y2={-it.h / 2} className="plan-frame" />
        </>
      ) : it.role === 'well' ? (
        // the town well: a stone ring with a curb
        <>
          <circle r={it.w / 2} fill="none" />
          <circle r={it.w / 4} className="plan-well-mouth" />
        </>
      ) : it.role === 'stall' ? (
        // a market stall: a small counter under a striped awning (a slatted top line)
        <>
          <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} rx={0.006} />
          <line x1={-it.w / 2} y1={-it.h / 2} x2={it.w / 2} y2={-it.h / 2} className="plan-awning" />
        </>
      ) : it.role === 'monument' ? (
        // an obelisk: a tall shaft on a plinth
        <>
          <rect x={-it.w / 2} y={it.h / 2 - 0.03} width={it.w} height={0.03} />
          <rect x={-it.w / 6} y={-it.h / 2} width={it.w / 3} height={it.h} />
        </>
      ) : it.role === 'stone' ? (
        // a memorial stela
        <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} rx={it.w / 2.4} />
      ) : it.role === 'tomb' ? (
        // a barrow ring with a capstone
        <>
          <circle r={it.w / 2} fill="none" />
          <rect x={-it.w / 5} y={-it.h / 5} width={it.w / 2.5} height={it.h / 2.5} />
        </>
      ) : it.shape === 'compound' ? (
        // a walled COMPOUND: a hall set inside its own yard wall (the wealthy of the core)
        <>
          <rect className="plan-yard" x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} rx={0.02} fill="none" />
          <rect x={-it.w / 2 + 0.03} y={-it.h / 2 + 0.03} width={it.w * 0.52} height={it.h - 0.06} rx={0.012} style={roofFill ? { fill: roofFill } : undefined} />
          <line x1={-it.w / 2 + 0.045} y1={0} x2={-it.w / 2 + 0.03 + it.w * 0.52 - 0.015} y2={0} className="plan-ridge" />
        </>
      ) : (
        <>
          {/* a ROW house in the dense core has square corners (attached); a cot is softer.
              The fill is the culture's ROOF colour; the roofline cue is its silhouette. */}
          <rect x={-hw} y={-hh} width={it.w} height={it.h} rx={it.shape === 'row' ? 0 : 0.012} style={roofFill ? { fill: roofFill } : undefined} />
          {(!st || st.roofShape === 'gable') && (
            // a pitched gable — the ridge that makes a rectangle read as a building
            <line x1={-hw + 0.015} y1={0} x2={hw - 0.015} y2={0} className="plan-ridge" />
          )}
          {st?.roofShape === 'flat' && (
            // a flat clay roof — a parapet outline, no ridge
            <rect className="plan-parapet" x={-hw + 0.02} y={-hh + 0.02} width={it.w - 0.04} height={it.h - 0.04} fill="none" />
          )}
          {st?.roofShape === 'conical' && (
            // a conical/hipped roof — hips run from the corners to a central apex
            <>
              <line className="plan-hip" x1={0} y1={0} x2={-hw} y2={-hh} />
              <line className="plan-hip" x1={0} y1={0} x2={hw} y2={-hh} />
              <line className="plan-hip" x1={0} y1={0} x2={hw} y2={hh} />
              <line className="plan-hip" x1={0} y1={0} x2={-hw} y2={hh} />
            </>
          )}
          {st?.chimney && (
            // a hearth's chimney — a small stack near the eave
            <rect className="plan-chimney" x={hw * 0.35} y={-hh * 0.7} width={Math.max(0.012, it.w * 0.14)} height={Math.max(0.012, it.w * 0.14)} />
          )}
        </>
      )}
    </g>
  );
}
