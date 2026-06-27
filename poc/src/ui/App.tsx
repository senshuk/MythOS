/**
 * The "watch the village" UI. Three panels: a dashboard digest, a scrolling
 * history feed (click an event to trace WHY it happened), and an inspector that
 * shows an actor's relationships/life or an event's causal ancestry.
 *
 * The UI is intentionally a thin, read-only renderer of snapshots.
 */
import { useState, useRef, useEffect } from 'react';
import type { EventView, EventPart, EventRef, SettlementView, PlayerView, NeedKey } from '../engine/model';
import type { Intent } from '../engine/intent';
import { NEEDS } from '../content/fixture';
import { MAP_STYLES, DEFAULT_MAP_STYLE, type MapStyle } from '../content/mapstyles';
import { paintTerrain, paintStarfield } from './terrain';
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

function foodLabel(security: number): string {
  if (security < 0.5) return '⚠ starving';
  if (security < 1) return 'lean';
  if (security > 1.8) return 'plentiful';
  return 'fed';
}
function foodClass(security: number): string {
  if (security < 0.5) return 'food-bad';
  if (security < 1) return 'food-warn';
  if (security > 1.8) return 'food-good';
  return 'muted';
}

// settlements on the map are coloured by their culture (presentation only)
const CULTURE_COLOR: Record<string, string> = {
  martial: '#e0685f', // the Iron Creed
  sylvan: '#6cc08a', // the Green Way
  artisan: '#e0b25e', // the Maker Folk
  free: '#6fb6d6', // the Free Companies
  devout: '#b79be0', // the Old Faith
};
const cultureColor = (id: string) => CULTURE_COLOR[id] ?? '#8a8f9e';
const CULTURE_NAMES: Record<string, string> = {
  martial: 'Iron Creed',
  sylvan: 'Green Way',
  artisan: 'Maker Folk',
  free: 'Free Companies',
  devout: 'Old Faith',
};

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

export default function App() {
  const sim = useSim(123456);
  const [seedInput, setSeedInput] = useState('123456');
  const [historyYears, setHistoryYears] = useState(200);
  const [saveName, setSaveName] = useState('quicksave');
  const [tab, setTab] = useState<'world' | 'chronicle' | 'inspector'>('world');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mapStyleId, setMapStyleId] = useState(DEFAULT_MAP_STYLE);

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
              busy={sim.busy}
            />
          ) : (
            <div className="onboard">
              ▶ <strong>Live as one of them.</strong> Click the ▶ beside any villager
              (in “Notable villagers” below, or in the inspector) to take control. You’ll
              get a goal and act a week at a time — and the world keeps going around you.
            </div>
          )}
          <div className="grid" data-tab={tab}>
            <Dashboard
              stat={stat}
              onPickActor={inspectActor}
              onFocus={(id) => sim.focusSettlement(id)}
              onInspectSettlement={(id) => inspectRef({ kind: 'settlement', id })}
              onSetStoryteller={(id) => sim.setStoryteller(id)}
              onPossess={(id) => sim.possess(id)}
              mapStyleId={mapStyleId}
              onSetMapStyle={setMapStyleId}
              busy={sim.busy}
            />
            <HistoryFeed events={stat.recentEvents} onPickEvent={inspectEvent} onRef={inspectRef} />
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
          </div>
          <nav className="bottombar">
            <div className="time-bar">
              <button onClick={() => sim.advance(1)} disabled={sim.busy}>+1 year</button>
              <button onClick={() => sim.advance(10)} disabled={sim.busy}>+10 years</button>
              <button onClick={() => sim.advance(60)} disabled={sim.busy}>+60 years</button>
            </div>
            <div className="tabs">
              <button className={tab === 'world' ? 'active' : ''} onClick={() => setTab('world')}>
                🗺 World
              </button>
              <button className={tab === 'chronicle' ? 'active' : ''} onClick={() => setTab('chronicle')}>
                📜 Chronicle
              </button>
              <button className={tab === 'inspector' ? 'active' : ''} onClick={() => setTab('inspector')}>
                🔍 Inspect
              </button>
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

const MAP_VB = { x: -8, y: -9, w: 116, h: 118 };

function RegionMap({
  map,
  seed,
  style,
  focusedId,
  onInspect,
  busy,
}: {
  map: NonNullable<ReturnType<typeof useSim>['snapshot']>['map'];
  seed: number;
  style: MapStyle;
  focusedId: number;
  onInspect: (id: number) => void;
  busy: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // paint the backdrop per the pack's map style — deterministic from the seed. A
  // surface theme paints terrain; 'starfield' paints space. (Presentation only.)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = 300;
    c.height = 305;
    const nodes = map.nodes.map((n) => ({ x: n.x, y: n.y, ruined: n.ruined }));
    if (style.kind === 'starfield') paintStarfield(c, seed, nodes, MAP_VB, style.field);
    else paintTerrain(c, seed, nodes, MAP_VB, style.theme);
    // positions are fixed per world, so the backdrop depends only on seed + style
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, style]);

  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const maxPop = Math.max(1, ...map.nodes.map((n) => n.population));
  const radius = (pop: number) => 2.4 + 4.6 * Math.sqrt(pop / maxPop);

  return (
    <div className={style.kind === 'starfield' ? 'map-wrap starfield' : 'map-wrap'}>
      <canvas ref={canvasRef} className="map-terrain" />
      <svg className="map" viewBox="-8 -9 116 118" preserveAspectRatio="xMidYMid meet">
      {/* edges: trade routes (jade, thicker with volume) vs hostile borders (rose, dashed) */}
      {map.edges.map((e, i) => {
        const a = nodeById.get(e.a)!;
        const b = nodeById.get(e.b)!;
        const trade = e.relation > 15;
        const hostile = e.relation < -20;
        return (
          <line
            key={i}
            className={`edge ${hostile ? 'hostile' : trade ? 'trade' : 'quiet'}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={hostile ? 'var(--rose)' : trade ? 'var(--jade)' : 'var(--line)'}
            strokeWidth={hostile ? 0.5 : trade ? 0.5 + Math.min(1.7, e.tradeVolume / 6) : 0.35}
            opacity={hostile ? 0.7 : trade ? 0.9 : 0.4}
          />
        );
      })}
      {/* nodes: coloured by culture, sized by population; click to inspect (ruins included) */}
      {map.nodes.map((n) => {
        const focused = n.id === focusedId;
        const r = n.ruined ? 1.9 : radius(n.population);
        const color = cultureColor(n.cultureId);
        return (
          <g key={n.id} className={busy ? 'mnode' : 'mnode clickable'} onClick={() => !busy && onInspect(n.id)}>
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
            <text
              x={n.x}
              y={n.y - r - 1.3}
              textAnchor="middle"
              fontSize="2.8"
              fill={n.ruined ? 'var(--rose)' : 'var(--ink-dim)'}
              opacity={n.ruined ? 0.7 : 0.95}
            >
              {n.ruined ? `⚑ ${n.name}` : n.name}
            </text>
          </g>
        );
      })}
      </svg>
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
  mapStyleId,
  onSetMapStyle,
  busy,
}: {
  stat: NonNullable<ReturnType<typeof useSim>['snapshot']>;
  onPickActor: (id: number) => void;
  onFocus: (id: number) => void;
  onInspectSettlement: (id: number) => void;
  onSetStoryteller: (id: string) => void;
  onPossess: (id: number) => void;
  mapStyleId: string;
  onSetMapStyle: (id: string) => void;
  busy: boolean;
}) {
  const mapStyle = MAP_STYLES.find((s) => s.id === mapStyleId)?.style ?? MAP_STYLES[0].style;
  return (
    <section className="panel dashboard">
      <h2>Year {stat.year}</h2>

      <div className="storyteller">
        <label>
          Storyteller:{' '}
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
          · {stat.director.mood} · {stat.director.incidents} incidents
        </span>
        <div className="tension-bar" title={`dramatic tension ${stat.director.tension}/200`}>
          <div className="tension-fill" style={{ width: `${Math.min(100, stat.director.tension / 2)}%` }} />
        </div>
      </div>

      <div className="worldscale">
        <div>
          <span className="ws-num">{stat.worldPopulation.toLocaleString()}</span> souls in the
          world across {stat.settlements.length} settlements
        </div>
        <div className="muted">
          only <strong>{stat.simulatedInDetail}</strong> simulated in detail right now (in{' '}
          {stat.settlementName}) — the rest evolve as aggregates
        </div>
        <div className="muted">
          + <strong>{stat.namedPeople}</strong> named people tracked across the world
          (summary tier) who carry their relationships when they move
        </div>
        <div className="muted">
          economy: <strong>{stat.worldWealth.toLocaleString()}</strong> total wealth, traded
          along the routes below
        </div>
      </div>

      {(stat.eras.length > 0 || stat.chronicle.length > 0) && (
        <>
          <h3>Chronicle — the world remembers</h3>
          {stat.eras.length > 0 && (
            <ul className="eras">
              {stat.eras.slice(0, 6).map((e, i) => (
                <li key={i}>
                  <span className="muted">y{e.year}:</span> {e.title}
                </li>
              ))}
            </ul>
          )}
          <ul className="legends">
            {stat.chronicle.slice(0, 8).map((t, i) => (
              <li key={i}>
                <span className="muted">y{t.year}</span> {t.text}
              </li>
            ))}
          </ul>
          {stat.historicalFigures.length > 0 && (
            <>
              <h4>Figures of history</h4>
              <ul className="figures-hist">
                {stat.historicalFigures.slice(0, 8).map((f, i) => (
                  <li key={i}>
                    <span className="fig-name">{f.name}</span>
                    <span className="muted">
                      {' '}
                      — {f.role} of {f.settlement},{' '}
                      {f.deathYear !== undefined ? `r.${f.reignStart}–${f.deathYear}` : `since y${f.reignStart}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <div className="map-head">
        <h3>Region map — click a settlement to read its story</h3>
        <select className="skin-select" value={mapStyleId} onChange={(e) => onSetMapStyle(e.target.value)} title="world skin (presentation only)">
          {MAP_STYLES.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <RegionMap map={stat.map} seed={stat.seed} style={mapStyle} focusedId={stat.focusedSettlementId} onInspect={onInspectSettlement} busy={busy} />
      <div className="legend">
        <span><i className="sw good" /> trade</span>
        <span><i className="sw bad" /> war</span>
        <span>● size = population</span>
      </div>
      <div className="legend cultures">
        {[...new Set(stat.map.nodes.map((n) => n.cultureId))].map((id) => (
          <span key={id}>
            <i className="cdot" style={{ background: cultureColor(id) }} /> {CULTURE_NAMES[id] ?? id}
          </span>
        ))}
      </div>

      <h3>{stat.settlementName} · focused</h3>
      <div className="stats">
        <Stat label="Population" value={stat.population} />
        <Stat label="Births" value={stat.totalBorn} />
        <Stat label="Deaths" value={stat.totalDied} />
        <Stat label="Marriages" value={stat.marriages} />
        <Stat label="Feuds" value={stat.feuds} />
      </div>

      <h3>Settlements — click to focus (full-fidelity)</h3>
      <ul className="settlements">
        {stat.settlements.map((s) => (
          <li key={s.id} className={s.detailed ? 'focused' : ''}>
            <button
              className="focus-btn"
              disabled={busy || s.detailed || s.population === 0}
              onClick={() => onFocus(s.id)}
              title={
                s.detailed
                  ? 'currently focused'
                  : s.population === 0
                    ? 'abandoned — nothing to simulate'
                    : 'focus (simulate in detail)'
              }
            >
              {s.detailed ? '◉' : s.ruinedYear !== undefined ? '⚑' : '○'} {s.name}
            </button>
            {s.ruinedYear !== undefined ? (
              <span className="muted ruin"> · ruin · fell y{s.ruinedYear}</span>
            ) : (
              <span className="muted">
                {' '}
                · {s.population} {s.dominantSpecies} · {s.specialization} · {s.wealth}w{' '}
                <span className={foodClass(s.foodSecurity)}>{foodLabel(s.foodSecurity)}</span>
                <span className="figs"> · {s.culture}</span>
                {s.leaderTitle && s.ruler ? (
                  <span className="ruler"> · {s.leaderTitle} {s.ruler}</span>
                ) : !s.leaderTitle ? (
                  <span className="figs"> · free folk (no ruler)</span>
                ) : null}
                {s.figureNames.length > 0 && (
                  <span className="figs"> · still there: {s.figureNames.join(', ')}</span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      <h3>Notable villagers (focused) — ▶ to play as one</h3>
      <ul className="notable">
        {stat.notable.map((a) => (
          <li key={a.id}>
            <button
              className="play-btn"
              onClick={() => onPossess(a.id)}
              disabled={busy || a.id === stat.player?.id}
              title={a.id === stat.player?.id ? 'you are playing as this villager' : 'play as this villager'}
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
  );
}

const NEED_BARS: NeedKey[] = NEEDS; // the pack's need vector (content/fixture)

function PlayerPanel({
  player,
  onAct,
  onRelease,
  onInspect,
  busy,
}: {
  player: PlayerView;
  onAct: (intent: Intent) => void;
  onRelease: () => void;
  onInspect: (id: number) => void;
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
          {player.lastAchieved && <div className="achieved">✓ {player.lastAchieved}</div>}
          <div className="goal">
            <span className="goal-tag">🎯 Goal</span>{' '}
            <span className="goal-label">{player.aspiration.label}</span>
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

          <div className="needs">
            {NEED_BARS.map((k) => {
              const v = player.needs[k];
              const pct = Math.round((v / 1000) * 100);
              const tone = v < 250 ? 'need-bad' : v < 450 ? 'need-warn' : 'need-good';
              return (
                <div className="need" key={k} title={`${k}: ${v}/1000`}>
                  <span className="need-label">{k}</span>
                  <div className="need-bar">
                    <div className={`need-fill ${tone}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

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
        </>
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

function HistoryFeed({
  events,
  onPickEvent,
  onRef,
}: {
  events: EventView[];
  onPickEvent: (id: number) => void;
  onRef: (ref: EventRef) => void;
}) {
  return (
    <section className="panel feed">
      <h2>History feed</h2>
      <ul>
        {events.map((ev) => (
          <li key={ev.id} className={`ev ${TYPE_TONE[ev.type] ?? 'neutral'}`}>
            {/* click a name to inspect it · click anywhere else to trace the causes */}
            <div className="ev-row" onClick={() => onPickEvent(ev.id)} role="button" tabIndex={0} title="trace causes">
              <span className="ev-year">y{ev.year}</span> <EventText parts={ev.parts} onRef={onRef} />
              {ev.causes.length > 0 && <span className="why"> · why?</span>}
            </div>
          </li>
        ))}
      </ul>
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
        <h2>Inspector</h2>
        <p className="muted">
          Click any <strong>name</strong> in the history — a person or a place — to inspect it, or
          click an event and follow <em>why?</em> to walk its causal chain.
        </p>
      </section>
    );
  }

  const settV = settlementDetail ? settlements.find((s) => s.id === settlementDetail.settlementId) : undefined;

  // a clickable history line: click a name to inspect it, click the line to trace its causes
  const eventLine = (ev: EventView) => (
    <li key={ev.id}>
      <span className="ev-inspect" onClick={() => onPickEvent(ev.id)} role="button" tabIndex={0}>
        <span className="ev-year">y{ev.year}</span> <EventText parts={ev.parts} onRef={onRef} />
      </span>
    </li>
  );

  return (
    <section className="panel inspector">
      <div className="inspector-head">
        <h2>Inspector</h2>
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
                  ▶ play as
                </button>
              ))}
          </h3>
          <p className="muted">
            {actorDetail.actor.species} {actorDetail.actor.profession} · {actorDetail.actor.ageYears}y ·{' '}
            {actorDetail.actor.sex} · traits: {actorDetail.actor.traits.join(', ') || 'none'}
          </p>

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
            {figureDetail.role} of{' '}
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
          {settV && !settV.detailed && settV.ruinedYear === undefined && (
            <button className="play-inline" onClick={() => onFocus(settlementDetail.settlementId)}>
              ◉ observe in detail
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
              <h4>Caused by (most recent first)</h4>
              <ol className="chain">{eventChain.ancestors.map(eventLine)}</ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
