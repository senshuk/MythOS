/**
 * The chronicle panel: the scrolling history feed (tiered by how momentous each
 * event is, with same-kind runs coalesced), the Legends & Ages deep history with
 * its era timeline, the Tongues view, and the Rankings ledger.
 */
import { useMemo } from 'react';
import type { EventView, EventRef, EraView, TaleView, FigureView, HouseView, TongueView, SettlementView } from '../engine/model';
import { TYPE_TONE, onActivate, usePersistentState, cultureName, EventText } from './common';
import { HouseShield } from './heraldry';

const FEED_FLOOR = 1; // interest below this is banal — digested (focused place) or dropped
// severity tiers (RimWorld's letters): an EPIC event gets banner treatment, a MAJOR one
// a highlighted row, the rest are plain lines. Calibrated to the pack's eventInterest.
const TIER_EPIC = 55;
const TIER_MAJOR = 34;
const RUN_MIN = 3; // consecutive same-kind minor events fold into one line at this length

// the focused place's demographic flux is worth a per-year tally; pure social chitchat
// (friendships, kindnesses, quarrels) is left to a person's inspector, never the feed.
const DIGEST_CAT: Record<string, string> = {
  born: 'births',
  immigrated: 'comings & goings',
  emigrated: 'comings & goings',
};

// how a coalesced run reads: "6 souls renounced their faith" — generic fallback for
// types the map doesn't know, so pack-invented events still fold cleanly.
const RUN_LABEL: Record<string, string> = {
  apostasy: 'souls renounced their faith',
  converted: 'souls found faith',
  married: 'couples were wed',
  died: 'long lives ended',
  milestone: 'milestones were reached',
  ascension: 'rulers rose',
  mental_break: 'souls broke under the strain',
  prosperity: 'strokes of good fortune',
  rivalry: 'rivalries kindled',
  org_recruited: 'polities raised levies',
  org_fortified: 'polities strengthened their defences',
  org_patrol: 'polities set patrols',
  org_festival: 'great festivals were held',
  org_trade_pact: 'trade pacts were opened',
  inherited: 'lines passed to their heirs',
};
const runLabel = (type: string, n: number) => `${n} ${RUN_LABEL[type] ?? `× ${type.replace(/_/g, ' ')}`}`;

type FeedItem =
  | { kind: 'event'; ev: EventView }
  | { kind: 'run'; year: number; type: string; evs: EventView[] }
  | { kind: 'digest'; year: number; counts: Record<string, number> };
const itemYear = (it: FeedItem) => (it.kind === 'event' ? it.ev.year : it.year);

/** Turn the raw event stream into a readable feed: in "notable" mode, momentous events (and
 *  anything touching the player) show individually, minor same-kind runs coalesce into one
 *  line, the focused place's everyday happenings fold into a per-year digest, and distant
 *  villages' chitchat is dropped. "everything" is the raw firehose. */
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
  // coalesce runs: consecutive MINOR events of one kind in one year become a single line
  // (the player's own thread never folds — their story stays individually legible).
  const folded: FeedItem[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.kind !== 'event' || it.ev.interest >= TIER_MAJOR || it.ev.involvesPlayer) {
      folded.push(it);
      i++;
      continue;
    }
    let j = i;
    const run: EventView[] = [];
    while (j < items.length) {
      const cand = items[j];
      if (
        cand.kind === 'event' &&
        cand.ev.type === it.ev.type &&
        cand.ev.year === it.ev.year &&
        cand.ev.interest < TIER_MAJOR &&
        !cand.ev.involvesPlayer
      ) {
        run.push(cand.ev);
        j++;
      } else break;
    }
    if (run.length >= RUN_MIN) {
      folded.push({ kind: 'run', year: it.ev.year, type: it.ev.type, evs: run });
      i = j;
    } else {
      folded.push(it);
      i++;
    }
  }
  for (const [year, counts] of digests) folded.push({ kind: 'digest', year, counts });
  folded.sort((a, b) => itemYear(b) - itemYear(a)); // newest first (stable: digest trails its year)
  return folded.slice(0, 120);
}

/** The severity tier class for one event row — banner, highlighted, or plain. */
const tierClass = (ev: EventView) => (ev.interest >= TIER_EPIC ? ' tier-epic' : ev.interest >= TIER_MAJOR ? ' tier-major' : '');

/** The named ages as a horizontal TIMELINE — dots on an axis, sized to the dock, no
 *  inline labels (they collided into noise): hover a dot for its age, click to trace it.
 *  The list beneath is the readable text; this strip shows WHERE in time the ages sit. */
function EraTimeline({ eras, currentYear, onPickEvent }: { eras: EraView[]; currentYear: number; onPickEvent: (id: number) => void }) {
  if (eras.length < 2) return null;
  const span = Math.max(currentYear, 1);
  const W = 560;
  const PAD = 16;
  const x = (year: number) => PAD + (year / span) * (W - 2 * PAD);
  return (
    <div className="era-strip-wrap">
      <svg className="era-strip" viewBox={`0 0 ${W} 30`} preserveAspectRatio="none" role="img" aria-label="timeline of the named ages">
        <line x1={PAD} y1={12} x2={W - PAD} y2={12} className="era-axis" />
        <text x={PAD} y={27} className="era-tick">y0</text>
        <text x={W - PAD} y={27} className="era-tick" textAnchor="end">y{currentYear}</text>
        {eras.map((e, i) => (
          <g
            key={i}
            className={e.eventId !== undefined ? 'era-dot clickable' : 'era-dot'}
            onClick={() => e.eventId !== undefined && onPickEvent(e.eventId)}
            onKeyDown={(ke) => { if ((ke.key === 'Enter' || ke.key === ' ') && e.eventId !== undefined) { ke.preventDefault(); onPickEvent(e.eventId); } }}
            tabIndex={e.eventId !== undefined ? 0 : undefined}
          >
            <title>{`y${e.year} — ${e.title}`}</title>
            {/* an invisible fat hit-area so small dots are still easy to hover/click */}
            <circle cx={x(e.year)} cy={12} r={9} fill="transparent" stroke="none" />
            <circle className="era-dot-mark" cx={x(e.year)} cy={12} r={3.6} />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** The rankings ledger — the age's standings, every line a click. */
function Rankings({
  houses,
  settlements,
  onRef,
}: {
  houses: HouseView[];
  settlements: SettlementView[];
  onRef: (ref: EventRef) => void;
}) {
  const living = settlements.filter((s) => s.ruinedYear === undefined);
  const byPrestige = [...houses].sort((a, b) => b.prestige - a.prestige).slice(0, 8);
  const byPop = [...living].sort((a, b) => b.population - a.population).slice(0, 8);
  const byWealth = [...living].sort((a, b) => b.wealth - a.wealth).slice(0, 8);
  const rankMark = (i: number) => <span className={`rank-n${i < 3 ? ` rank-${i + 1}` : ''}`}>{i + 1}</span>;
  return (
    <div className="rankings">
      <h3>Most renowned Houses</h3>
      <ol className="rank-list">
        {byPrestige.map((h, i) => (
          <li key={h.id}>
            {rankMark(i)}
            <HouseShield id={h.id} name={h.name} size={17} />
            <button className="link house-name" onClick={() => onRef({ kind: 'house', id: h.id })}>House {h.name}</button>
            <span className="rank-val" title="renown">{h.prestige}</span>
          </li>
        ))}
      </ol>
      <h3>Greatest settlements</h3>
      <ol className="rank-list">
        {byPop.map((s, i) => (
          <li key={s.id}>
            {rankMark(i)}
            <button className="link" onClick={() => onRef({ kind: 'settlement', id: s.id })}>{s.name}</button>
            <span className="rank-val" title="souls">{s.population.toLocaleString()}</span>
          </li>
        ))}
      </ol>
      <h3>Richest settlements</h3>
      <ol className="rank-list">
        {byWealth.map((s, i) => (
          <li key={s.id}>
            {rankMark(i)}
            <button className="link" onClick={() => onRef({ kind: 'settlement', id: s.id })}>{s.name}</button>
            <span className="rank-val" title="wealth">{s.wealth}w</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HistoryFeed({
  events,
  eras,
  legends,
  figures,
  houses,
  tongues,
  settlements,
  currentYear,
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
  settlements: SettlementView[];
  currentYear: number;
  focusedName: string;
  onPickEvent: (id: number) => void;
  onRef: (ref: EventRef) => void;
}) {
  const [view, setView] = usePersistentState<'recent' | 'legends' | 'tongues' | 'rankings'>('mythos.feed.view', 'recent');
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
        <button className={view === 'rankings' ? 'on' : ''} onClick={() => setView('rankings')}>Rankings</button>
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
                  <li key={`e${it.ev.id}`} className={`ev ${TYPE_TONE[it.ev.type] ?? 'neutral'}${tierClass(it.ev)}`}>
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
                ) : it.kind === 'run' ? (
                  <li key={`r${it.type}:${it.year}:${it.evs[0].id}`} className={`ev ${TYPE_TONE[it.type] ?? 'neutral'}`}>
                    {/* a coalesced run — one line for the pattern, expandable to its members */}
                    <details className="ev-run">
                      <summary className="ev-row run-row">
                        <span className="ev-year">y{it.year}</span> {runLabel(it.type, it.evs.length)}
                        <span className="run-toggle" aria-hidden="true"> · show</span>
                      </summary>
                      <ul className="run-members">
                        {it.evs.map((ev) => (
                          <li key={ev.id} className={`ev ${TYPE_TONE[ev.type] ?? 'neutral'}`}>
                            <div
                              className="ev-row"
                              onClick={() => onPickEvent(ev.id)}
                              onKeyDown={(e) => onActivate(e, () => onPickEvent(ev.id))}
                              role="button"
                              tabIndex={0}
                              title="trace causes"
                            >
                              <span className="ev-year">y{ev.year}</span> <EventText parts={ev.parts} onRef={onRef} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
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
      ) : view === 'rankings' ? (
        houses.length === 0 && settlements.length === 0 ? (
          <p className="muted">Nothing to rank yet — the age is young.</p>
        ) : (
          <Rankings houses={houses} settlements={settlements} onRef={onRef} />
        )
      ) : view === 'tongues' ? (
        tongues.length === 0 ? (
          <p className="muted">No living tongues — this world has no peoples to speak them.</p>
        ) : (
          <div className="tongues">
            {tongues.map((t) => (
              <div key={t.cultureId} className="tongue">
                <h3>
                  <button className="link" onClick={() => onRef({ kind: 'culture', id: t.cultureId })}>{cultureName(t.cultureId)}</button> — <span className="tongue-demonym">the {t.demonym}</span>
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
              <EraTimeline eras={eras} currentYear={currentYear} onPickEvent={onPickEvent} />
              <ul className="eras">
                {eras.slice(0, 8).map((e, i) => (
                  <li key={i}>
                    <span className="muted">y{e.year}:</span>{' '}
                    {e.eventId !== undefined ? (
                      <button className="link" onClick={() => onPickEvent(e.eventId!)} title="trace this age's defining event">{e.title}</button>
                    ) : e.title}
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
                    <HouseShield id={h.id} name={h.name} size={22} className="house-arms" />
                    <div className="house-body">
                      <button className="link house-name" onClick={() => onRef({ kind: 'house', id: h.id })}>House {h.name}</button>
                      {h.meaning ? <span className="house-gloss"> · {h.meaning}</span> : null}
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
                    </div>
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
                    <button className="link fig-name" onClick={() => onRef({ kind: 'figure', id: f.id })}>{f.name}</button>
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
                    <span className="muted">y{t.year}</span>{' '}
                    {t.eventId !== undefined ? (
                      <button className="link legend-link" onClick={() => onPickEvent(t.eventId!)} title="trace the deed behind the legend">{t.text}</button>
                    ) : t.text}
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
