/**
 * The "watch the village" UI. Three panels: a dashboard digest, a scrolling
 * history feed (click an event to trace WHY it happened), and an inspector that
 * shows an actor's relationships/life or an event's causal ancestry.
 *
 * The UI is intentionally a thin, read-only renderer of snapshots. This file is
 * the shell — header controls, layout, tab state; the panels live in Feed.tsx,
 * MapView.tsx, Inspector.tsx and PlayerCockpit.tsx.
 */
import { useState } from 'react';
import type { EventRef, Snapshot } from '../engine/model';
import { useSim } from './useSim';
import { usePersistentState, cultureColor, cultureName } from './common';
import { RegionMap } from './MapView';
import { HistoryFeed } from './Feed';
import { PlayerPanel } from './PlayerCockpit';
import { Inspector } from './Inspector';

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
              houseDetail={sim.houseDetail}
              cultureDetail={sim.cultureDetail}
              deityDetail={sim.deityDetail}
              featureDetail={sim.featureDetail}
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

function Dashboard({
  stat,
  onPickActor,
  onFocus,
  onInspectSettlement,
  onSetStoryteller,
  onPossess,
  busy,
}: {
  stat: Snapshot;
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
