/**
 * The "watch the village" UI. Three panels: a dashboard digest, a scrolling
 * history feed (click an event to trace WHY it happened), and an inspector that
 * shows an actor's relationships/life or an event's causal ancestry.
 *
 * The UI is intentionally a thin, read-only renderer of snapshots.
 */
import { useMemo, useState } from 'react';
import type { ActorView, EventView, PlayerView, NeedKey } from '../engine/model';
import type { Intent } from '../engine/intent';
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

export default function App() {
  const sim = useSim(123456);
  const [seedInput, setSeedInput] = useState('123456');
  const [historyYears, setHistoryYears] = useState(200);

  const stat = sim.snapshot;

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">
          MythOS · <strong>The Living Village</strong>
          {stat && <span className="village"> — {stat.settlementName}</span>}
        </div>
        <div className="controls">
          <label>
            seed{' '}
            <input
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              size={8}
            />
          </label>
          <label>
            history{' '}
            <select
              value={historyYears}
              onChange={(e) => setHistoryYears(Number(e.target.value))}
              disabled={sim.busy}
            >
              <option value={0}>none</option>
              <option value={100}>1 century</option>
              <option value={200}>2 centuries</option>
              <option value={500}>5 centuries</option>
            </select>
          </label>
          <button
            onClick={() => {
              const seed = Number(seedInput) || 0;
              if (historyYears > 0) sim.genesis(seed, historyYears);
              else sim.reset(seed);
            }}
            disabled={sim.busy}
          >
            {historyYears > 0 ? 'Forge world' : 'New world'}
          </button>
          <button onClick={() => sim.advance(1)} disabled={sim.busy}>
            +1 year
          </button>
          <button onClick={() => sim.advance(10)} disabled={sim.busy}>
            +10 years
          </button>
          <button onClick={() => sim.advance(60)} disabled={sim.busy}>
            +60 years
          </button>
          {sim.busy && <span className="busy">simulating…</span>}
        </div>
      </header>

      {!stat ? (
        <div className="loading">Booting simulation worker…</div>
      ) : (
        <>
          {stat.player && (
            <PlayerPanel
              player={stat.player}
              onAct={(intent) => sim.playerAct(intent)}
              onRelease={() => sim.release()}
              onInspect={(id) => sim.inspectActor(id)}
              busy={sim.busy}
            />
          )}
          <div className="grid">
            <Dashboard
              stat={stat}
              onPickActor={(id) => sim.inspectActor(id)}
              onFocus={(id) => sim.focusSettlement(id)}
              onSetStoryteller={(id) => sim.setStoryteller(id)}
              onPossess={(id) => sim.possess(id)}
              busy={sim.busy}
            />
            <HistoryFeed
              events={stat.recentEvents}
              onPickEvent={(id) => sim.inspectEvent(id)}
              onPickActor={(id) => sim.inspectActor(id)}
            />
            <Inspector
              actorDetail={sim.actorDetail}
              eventChain={sim.eventChain}
              actorsById={stat.actors}
              playerId={stat.player?.id}
              onPickActor={(id) => sim.inspectActor(id)}
              onPickEvent={(id) => sim.inspectEvent(id)}
              onPossess={(id) => sim.possess(id)}
              onClose={sim.clearInspect}
            />
          </div>
        </>
      )}
      <footer className="foot">
        Deterministic worker-isolated ECS sim · same seed ⇒ identical history ·
        click any event to trace its causes
      </footer>
    </div>
  );
}

function RegionMap({
  map,
  focusedId,
  onFocus,
  busy,
}: {
  map: NonNullable<ReturnType<typeof useSim>['snapshot']>['map'];
  focusedId: number;
  onFocus: (id: number) => void;
  busy: boolean;
}) {
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const maxPop = Math.max(1, ...map.nodes.map((n) => n.population));
  const radius = (pop: number) => 2 + 4 * Math.sqrt(pop / maxPop);
  const edgeColor = (rel: number) => (rel > 15 ? 'var(--good)' : rel < -20 ? 'var(--bad)' : 'var(--line)');

  return (
    <svg className="map" viewBox="-6 -6 112 112" preserveAspectRatio="xMidYMid meet">
      {map.edges.map((e, i) => {
        const a = nodeById.get(e.a)!;
        const b = nodeById.get(e.b)!;
        const hostile = e.relation < -20;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={edgeColor(e.relation)}
            strokeWidth={hostile ? 0.5 : 0.4 + Math.min(1.6, e.tradeVolume / 6)}
            strokeDasharray={hostile ? '1.6 1.1' : undefined}
            opacity={0.85}
          />
        );
      })}
      {map.nodes.map((n) => {
        const focused = n.id === focusedId;
        const clickable = !busy && !focused && !n.ruined && n.population > 0;
        const r = n.ruined ? 1.6 : radius(n.population);
        return (
          <g
            key={n.id}
            className={clickable ? 'mnode clickable' : 'mnode'}
            onClick={() => clickable && onFocus(n.id)}
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={r}
              fill={n.ruined ? 'none' : focused ? 'var(--accent)' : 'var(--panel2)'}
              stroke={n.ruined ? 'var(--bad)' : focused ? 'var(--accent)' : 'var(--muted)'}
              strokeWidth={focused ? 1.1 : n.ruined ? 0.5 : 0.4}
              strokeDasharray={n.ruined ? '0.8 0.8' : undefined}
            />
            <text
              x={n.x}
              y={n.y - r - 1}
              textAnchor="middle"
              fontSize="2.7"
              fill={n.ruined ? 'var(--bad)' : focused ? 'var(--accent)' : 'var(--muted)'}
              opacity={n.ruined ? 0.7 : 1}
            >
              {n.ruined ? `⚑ ${n.name}` : n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Dashboard({
  stat,
  onPickActor,
  onFocus,
  onSetStoryteller,
  onPossess,
  busy,
}: {
  stat: NonNullable<ReturnType<typeof useSim>['snapshot']>;
  onPickActor: (id: number) => void;
  onFocus: (id: number) => void;
  onSetStoryteller: (id: string) => void;
  onPossess: (id: number) => void;
  busy: boolean;
}) {
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

      <h3>Region map — click a settlement to focus it</h3>
      <RegionMap map={stat.map} focusedId={stat.focusedSettlementId} onFocus={onFocus} busy={busy} />
      <div className="legend">
        <span><i className="sw good" /> trade route</span>
        <span><i className="sw bad" /> hostile border</span>
        <span><i className="sw neutral" /> quiet</span>
        <span>● node size = population</span>
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
                {s.ruler && <span className="ruler"> · ruled by {s.ruler}</span>}
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

const NEED_BARS: NeedKey[] = ['food', 'wealth', 'safety', 'esteem', 'belonging'];

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
}: {
  events: EventView[];
  onPickEvent: (id: number) => void;
  onPickActor: (id: number) => void;
}) {
  return (
    <section className="panel feed">
      <h2>History feed</h2>
      <ul>
        {events.map((ev) => (
          <li key={ev.id} className={`ev ${TYPE_TONE[ev.type] ?? 'neutral'}`}>
            <button
              className="ev-btn"
              onClick={() => onPickEvent(ev.id)}
              title="trace causes"
            >
              <span className="ev-year">y{ev.year}</span> {ev.text}
              {ev.causes.length > 0 && <span className="why"> · why?</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Inspector({
  actorDetail,
  eventChain,
  actorsById,
  playerId,
  onPickActor,
  onPickEvent,
  onPossess,
  onClose,
}: {
  actorDetail: ReturnType<typeof useSim>['actorDetail'];
  eventChain: ReturnType<typeof useSim>['eventChain'];
  actorsById: ActorView[];
  playerId?: number;
  onPickActor: (id: number) => void;
  onPickEvent: (id: number) => void;
  onPossess: (id: number) => void;
  onClose: () => void;
}) {
  const nameMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of actorsById) m.set(a.id, a.name);
    return m;
  }, [actorsById]);

  if (!actorDetail && !eventChain) {
    return (
      <section className="panel inspector empty">
        <h2>Inspector</h2>
        <p className="muted">
          Click a villager to see their relationships &amp; life, or click an event
          and follow <em>why?</em> to walk its causal chain.
        </p>
      </section>
    );
  }

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
            {!actorDetail.actor.alive && (
              <span className="muted">
                (died y{actorDetail.actor.deathYear})
              </span>
            )}
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
            {actorDetail.actor.species} {actorDetail.actor.profession} ·{' '}
            {actorDetail.actor.ageYears}y · {actorDetail.actor.sex} · traits:{' '}
            {actorDetail.actor.traits.join(', ') || 'none'}
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
          <ul className="rels">
            {actorDetail.lifeEvents.map((ev) => (
              <li key={ev.id}>
                <button className="link" onClick={() => onPickEvent(ev.id)}>
                  y{ev.year}: {ev.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {eventChain && (
        <div>
          <h3>Why did this happen?</h3>
          <p className="ev-root">
            <strong>
              y{eventChain.root.year}: {eventChain.root.text}
            </strong>
          </p>
          {eventChain.ancestors.length === 0 ? (
            <p className="muted">
              This was an originating event — nothing caused it.
            </p>
          ) : (
            <>
              <h4>Caused by (most recent first)</h4>
              <ol className="chain">
                {eventChain.ancestors.map((ev) => (
                  <li key={ev.id}>
                    <button className="link" onClick={() => onPickEvent(ev.id)}>
                      y{ev.year}: {ev.text}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="muted small">
            subjects:{' '}
            {eventChain.root.subjects
              .map((id) => nameMap.get(id) ?? `#${id}`)
              .join(', ')}
          </p>
        </div>
      )}
    </section>
  );
}
