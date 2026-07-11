/**
 * The "watch the world" shell. The MAP IS THE STAGE: it fills the screen, and
 * everything else docks over it — the player cockpit + world panel on the left,
 * the chronicle on the right, and the inspector as a floating overlay with its
 * own back/forward trail. On a phone the same pieces become bottom tabs.
 *
 * The UI is intentionally a thin, read-only renderer of snapshots. This file is
 * the shell — header controls, layout, tab state, navigation history; the panels
 * live in WorldPanel.tsx, Feed.tsx, MapView.tsx, Inspector.tsx, PlayerCockpit.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventRef } from '../engine/model';
import { useSim, type LocalFacts } from './useSim';
import { usePersistentState } from './common';
import { RegionMap } from './MapView';
import { LocalMapView } from './LocalMapView';
import { HistoryFeed } from './Feed';
import { PlayerPanel } from './PlayerCockpit';
import { Inspector, type InspectorNav } from './Inspector';
import { WorldPanel } from './WorldPanel';
import { SearchPalette } from './SearchPalette';
import { PeekLayer } from './peek';
import { Icon } from './icons';

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

/** One stop on the inspector's trail — everything inspectable, as plain data. */
type NavTarget = { kind: 'ref'; ref: EventRef } | { kind: 'event'; id: number };
const sameTarget = (a: NavTarget, b: NavTarget) =>
  a.kind === 'event' ? b.kind === 'event' && a.id === b.id : b.kind === 'ref' && a.ref.kind === b.ref.kind && a.ref.id === b.ref.id;

export default function App() {
  const sim = useSim(123456);
  const [seedInput, setSeedInput] = useState('123456');
  const [historyYears, setHistoryYears] = useState(200);
  const [saveName, setSaveName] = useState('quicksave');
  const [tab, setTab] = useState<'world' | 'chronicle' | 'inspector'>('world');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [onboardDismissed, setOnboardDismissed] = usePersistentState('mythos.onboardDismissed', false);
  const [leftOpen, setLeftOpen] = usePersistentState('mythos.dock.left', true);
  const [rightOpen, setRightOpen] = usePersistentState('mythos.dock.right', true);
  // THE CLOSE VIEW (design/24 L1): which settlement's streets we're walking, if any
  const [closeViewId, setCloseViewId] = useState<number | null>(null);
  // …and its facts, fetched out-of-band: notable history for the HISTORY MARKS (L3)
  // and households for WHO LIVES WHERE (L2 — focused settlement only)
  const [closeFacts, setCloseFacts] = useState<({ id: number } & LocalFacts) | null>(null);

  const stat = sim.snapshot;
  // a reforged/reloaded world may not contain the settlement we were standing in
  const closeSettlement = closeViewId !== null ? stat?.settlements.find((s) => s.id === closeViewId) : undefined;
  useEffect(() => {
    if (closeViewId !== null && stat && !closeSettlement) setCloseViewId(null);
  }, [closeViewId, stat, closeSettlement]);
  // fetch the facts when entering (and re-fetch when time moves — a new snapshot may
  // carry new history or new households). The stale-guard drops crossed replies.
  useEffect(() => {
    if (closeViewId === null) {
      setCloseFacts(null);
      return;
    }
    let stale = false;
    void sim.localFacts(closeViewId).then((facts) => {
      if (!stale) setCloseFacts({ id: closeViewId, ...facts });
    });
    return () => {
      stale = true;
    };
  }, [closeViewId, sim.localFacts, stat?.year]);

  // ------------------------------------------------ inspector trail --------
  // Browser-style history over inspections: walk a cause chain three deep and
  // still find your way back. The stacks live in refs (no re-render per push);
  // navTick re-renders the back/forward buttons.
  const past = useRef<NavTarget[]>([]);
  const future = useRef<NavTarget[]>([]);
  const [, setNavTick] = useState(0);
  const bump = () => setNavTick((t) => t + 1);
  const dispatch = useCallback(
    (t: NavTarget) => (t.kind === 'event' ? sim.inspectEvent(t.id) : sim.inspectRef(t.ref)),
    [sim.inspectEvent, sim.inspectRef],
  );
  // navigating jumps to the Inspector tab on mobile (harmless on desktop)
  const navigate = useCallback(
    (t: NavTarget) => {
      const last = past.current[past.current.length - 1];
      if (!last || !sameTarget(last, t)) {
        past.current.push(t);
        if (past.current.length > 60) past.current.shift();
        future.current = [];
      }
      dispatch(t);
      bump();
      setTab('inspector');
    },
    [dispatch],
  );
  const navBack = useCallback(() => {
    if (past.current.length < 2) return;
    future.current.push(past.current.pop()!);
    dispatch(past.current[past.current.length - 1]);
    bump();
  }, [dispatch]);
  const navForward = useCallback(() => {
    const t = future.current.pop();
    if (!t) return;
    past.current.push(t);
    dispatch(t);
    bump();
  }, [dispatch]);
  const nav: InspectorNav = {
    back: navBack,
    forward: navForward,
    canBack: past.current.length > 1,
    canForward: future.current.length > 0,
  };

  const inspectRef = (ref: EventRef) => navigate({ kind: 'ref', ref });
  const inspectActor = (id: number) => navigate({ kind: 'ref', ref: { kind: 'actor', id } });
  const inspectEvent = (id: number) => navigate({ kind: 'event', id });
  const closeInspect = () => {
    sim.clearInspect(); // the trail survives a close — back reopens where you were
    if (tab === 'inspector') setTab('world');
  };
  const inspectorOpen = !!(
    sim.actorDetail || sim.eventChain || sim.figureDetail || sim.settlementDetail ||
    sim.houseDetail || sim.cultureDetail || sim.deityDetail || sim.featureDetail || sim.venueDetail
  );

  // ------------------------------------------------ quick-find (Ctrl/⌘-K) --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if (e.key === 'Escape') setCloseViewId(null); // step back out to the world
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <PeekLayer peek={sim.peek}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">Myth<span className="dot">OS</span></span>
            {stat && <span className="village">{stat.settlementName}</span>}
          </div>
          {stat && (
            <button className="find-btn" onClick={() => setSearchOpen(true)} title="find anything (Ctrl K)" aria-label="find anything">
              <Icon name="search" /> <span className="find-label">Find</span> <kbd>⌃K</kbd>
            </button>
          )}
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
          <main className="stage" data-tab={tab} data-left={leftOpen} data-right={rightOpen}>
            {/* THE STAGE — the world itself, everything else floats over it. The world
                map stays mounted under the close view (its paint guard skips at 0 size),
                so stepping back out costs nothing. */}
            <div className="stage-map-box">
              <div className={`stage-layer${closeSettlement ? ' beneath' : ''}`}>
                <RegionMap
                  map={stat.map}
                  seed={stat.seed}
                  focusedId={stat.focusedSettlementId}
                  settlements={stat.settlements}
                  onInspect={(id) => inspectRef({ kind: 'settlement', id })}
                  onRef={inspectRef}
                  onEnter={(id) => setCloseViewId(id)}
                  busy={sim.busy}
                />
              </div>
              {closeSettlement && (
                <div className="stage-layer close-enter">
                  <LocalMapView
                    settlement={closeSettlement}
                    map={stat.map}
                    seed={stat.seed}
                    currentYear={stat.year}
                    chronicle={closeFacts?.id === closeSettlement.id ? closeFacts.events : undefined}
                    households={closeFacts?.id === closeSettlement.id ? closeFacts.households : undefined}
                    venues={closeFacts?.id === closeSettlement.id ? closeFacts.venues : undefined}
                    onExit={() => setCloseViewId(null)}
                    onRef={inspectRef}
                    onPickEvent={inspectEvent}
                  />
                </div>
              )}
            </div>

            {/* the world's vitals, at a glance */}
            <div className="hud-chip">
              <span className="hud-year">Year {stat.year}</span>
              <span className="hud-sep" />
              <span className="hud-souls" title={`${stat.worldPopulation.toLocaleString()} souls across ${stat.settlements.length} settlements`}>
                {stat.worldPopulation.toLocaleString()} souls
              </span>
              <span className="hud-sep" />
              <span className="hud-place" title="where your gaze rests">{stat.settlementName}</span>
              {sim.busy && <span className="hud-busy">· simulating…</span>}
            </div>

            {/* LEFT DOCK — the cockpit (you) and the world panel */}
            <aside className={`dock dock-left${leftOpen ? '' : ' closed'}`}>
              <button
                className="dock-toggle toggle-left"
                onClick={() => setLeftOpen((v) => !v)}
                title={leftOpen ? 'hide panel' : 'show panel'}
                aria-label={leftOpen ? 'hide left panel' : 'show left panel'}
              >
                <Icon name={leftOpen ? 'chevronL' : 'chevronR'} />
              </button>
              <div className="dock-scroll">
                {stat.player ? (
                  <PlayerPanel
                    player={stat.player}
                    onAct={(intent) => sim.playerAct(intent)}
                    onRelease={() => sim.release()}
                    onInherit={() => sim.inherit()}
                    onInspect={inspectActor}
                    onRef={inspectRef}
                    onChooseAmbition={(id, target) => sim.chooseAmbition(id, target)}
                    onAbandonAmbition={() => sim.abandonAmbition()}
                    busy={sim.busy}
                  />
                ) : onboardDismissed ? null : (
                  <div className="onboard">
                    <span>
                      <Icon name="play" size={0.85} /> <strong>Live as one of them.</strong> Press the play mark beside any soul
                      (in “Notable folk” below, or in the inspector) to take up their life. You’ll
                      be given a purpose and live a week at a time — and the world goes on around you.
                    </span>
                    <button className="onboard-x" aria-label="dismiss" onClick={() => setOnboardDismissed(true)}>
                      ×
                    </button>
                  </div>
                )}
                <WorldPanel
                  stat={stat}
                  onPickActor={inspectActor}
                  onFocus={(id) => sim.focusSettlement(id)}
                  onSetStoryteller={(id) => sim.setStoryteller(id)}
                  onPossess={(id) => sim.possess(id)}
                  onWalk={(id) => setCloseViewId(id)}
                  busy={sim.busy}
                />
              </div>
            </aside>

            {/* RIGHT DOCK — the chronicle */}
            <aside className={`dock dock-right${rightOpen ? '' : ' closed'}`}>
              <button
                className="dock-toggle toggle-right"
                onClick={() => setRightOpen((v) => !v)}
                title={rightOpen ? 'hide chronicle' : 'show chronicle'}
                aria-label={rightOpen ? 'hide chronicle' : 'show chronicle'}
              >
                <Icon name={rightOpen ? 'chevronR' : 'chevronL'} />
              </button>
              <div className="dock-scroll">
                <HistoryFeed
                  events={stat.recentEvents}
                  eras={stat.eras}
                  legends={stat.chronicle}
                  figures={stat.historicalFigures}
                  houses={stat.houses}
                  tongues={stat.tongues}
                  settlements={stat.settlements}
                  currentYear={stat.year}
                  focusedName={stat.settlementName}
                  onPickEvent={inspectEvent}
                  onRef={inspectRef}
                />
              </div>
            </aside>

            {/* INSPECTOR — a floating window over the stage, with its own trail */}
            <div className="inspector-wrap" data-open={inspectorOpen}>
              <Inspector
                actorDetail={sim.actorDetail}
                eventChain={sim.eventChain}
                figureDetail={sim.figureDetail}
                settlementDetail={sim.settlementDetail}
                houseDetail={sim.houseDetail}
                cultureDetail={sim.cultureDetail}
                deityDetail={sim.deityDetail}
                featureDetail={sim.featureDetail}
                venueDetail={sim.venueDetail}
                settlements={stat.settlements}
                playerId={stat.player?.id}
                nav={nav}
                onPickActor={inspectActor}
                onPickEvent={inspectEvent}
                onRef={inspectRef}
                onFocus={(id) => sim.focusSettlement(id)}
                onPossess={(id) => sim.possess(id)}
                onWalk={(id) => setCloseViewId(id)}
                onClose={closeInspect}
              />
            </div>
          </main>
        )}

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

        {stat && <SearchPalette stat={stat} open={searchOpen} onClose={() => setSearchOpen(false)} onGo={inspectRef} />}
      </div>
    </PeekLayer>
  );
}
