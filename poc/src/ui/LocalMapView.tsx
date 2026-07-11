/**
 * THE CLOSE VIEW (design/24, phase L1): one settlement four hundred times closer —
 * the same deterministic world. Terrain is the real Geography sampled over a ~11-unit
 * frame (paintTerrain's per-pixel fractal detail resolves it crisply); the town plan
 * is the pack's LocalGenStep pipeline (content/localmap.ts) drawn as an SVG overlay.
 * Pure presentation: nothing here is stored, and the sim never sees it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RegionMapView, SettlementView, EventRef, EventView, HouseholdView } from '../engine/model';
import { SurfaceSubstrate } from '../engine/substrate';
import { substrateFor } from './substrateCache';
import { MAP_STYLES, type MapStyle } from '../content/mapstyles';
import { buildLocalPlan, type LocalPlanFacts, type PlanItem } from '../content/localmap';
import { paintTerrain, buildRoads, buildLocalRivers, type TerrainLabel, type LocalRiver } from './terrain';
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

  // paint the terrain once per frame change — the close view is a composed vista, not
  // a pannable stage (L1); paintTerrain's per-pixel fractal detail does the amplifying
  useEffect(() => {
    if (!(sub instanceof SurfaceSubstrate) || !SURF_THEME) return;
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.min(1600, Math.round(rect.width * dpr));
    c.height = Math.min(1600, Math.round(rect.height * dpr));
    paintTerrain(c, sub.geography, frame, SURF_THEME, labels);
  }, [sub, frame, labels]);

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
    <div ref={wrapRef} className="map-wrap local-wrap">
      <canvas ref={canvasRef} className="map-terrain" />
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
        {rivers.map((rv, i) => (
          <path
            key={`rv${i}`}
            className="local-river"
            d={rv.d}
            strokeWidth={rv.width}
            style={{ animationDuration: `${(9 - rv.speed * 6.6).toFixed(2)}s` }}
          />
        ))}
        {plan && plan.items.map((it, i) => <PlanGlyph key={i} it={it} show={show} hide={hide} onRef={onRef} onPickEvent={onPickEvent} />)}
      </svg>

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
  if (it.kind === 'street' || it.kind === 'pier' || it.kind === 'wall' || it.kind === 'barricade' || it.kind === 'packed') {
    const d = it.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ');
    return (
      <path
        className={`plan-${it.kind}`}
        d={d}
        fill="none"
        strokeWidth={it.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        onMouseEnter={it.label ? show(it.label) : undefined}
        onMouseLeave={it.label ? hide : undefined}
      />
    );
  }
  if (it.kind === 'tree') {
    return <circle className="plan-tree" cx={it.x} cy={it.y} r={it.r} />;
  }
  if (it.kind === 'field' || it.kind === 'rubble' || it.kind === 'square' || it.kind === 'scorch') {
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
          <rect className={`plan-${it.kind}`} x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} />
        )}
        {it.kind === 'field' && (
          // furrow lines — the strip-plot look
          <>
            <line className="plan-furrow" x1={-it.w / 2 + 0.04} y1={-it.h / 6} x2={it.w / 2 - 0.04} y2={-it.h / 6} />
            <line className="plan-furrow" x1={-it.w / 2 + 0.04} y1={it.h / 6} x2={it.w / 2 - 0.04} y2={it.h / 6} />
          </>
        )}
      </g>
    );
  }
  if (it.kind !== 'building') return null; // exhaustiveness guard — narrows for TS too
  const cls = `plan-building tone-${it.tone} role-${it.role}${it.inhabited ? ' inhabited' : ''}`;
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
      {it.role === 'monument' ? (
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
      ) : (
        <>
          <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} rx={0.012} />
          {/* the roof ridge — one line makes a rectangle read as a building */}
          <line x1={-it.w / 2 + 0.015} y1={0} x2={it.w / 2 - 0.015} y2={0} className="plan-ridge" />
        </>
      )}
    </g>
  );
}
