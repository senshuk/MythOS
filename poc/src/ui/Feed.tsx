/**
 * The chronicle panel: the scrolling history feed (with its notable/digest
 * processing), the Legends & Ages deep history, and the Tongues view.
 */
import { useMemo } from 'react';
import type { EventView, EventRef, EraView, TaleView, FigureView, HouseView, TongueView } from '../engine/model';
import { TYPE_TONE, onActivate, usePersistentState, cultureName, EventText } from './common';

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

export function HistoryFeed({
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
