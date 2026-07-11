/**
 * The inspector side panel: a closer look at whatever was clicked — an actor's
 * relationships/life, a figure, a House's lineage, a culture, a deity, a named
 * feature, a settlement, or an event's causal ancestry.
 */
import { Fragment } from 'react';
import type { EventView, EventRef, SettlementView, ActorDetail, EventChain, FigureDetail, SettlementDetail, HouseDetail, CultureDetail, DeityDetail, FeatureDetail, VenueDetail } from '../engine/model';
import { layoutLineage, LINEAGE_METRICS } from './lineageLayout';
import { onActivate, EventText } from './common';
import { HouseShield } from './heraldry';
import { Icon } from './icons';

/** Browser-style trail through inspections — walk a cause chain three deep and still
 *  find your way back (every legends browser learned this the hard way). */
export interface InspectorNav {
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
}

type HouseMember = HouseDetail['members'][number];

/** How a member's life reads in the line: role, birth–death, and reign span. */
function memberDates(m: HouseMember): string {
  const life = `b.${m.bornYear}${m.deathYear !== undefined ? `–${m.deathYear}` : ''}`;
  const reign = m.deathYear !== undefined ? `r.${m.reignStart}–${m.deathYear}` : `ruling since y${m.reignStart}`;
  return `${m.role} · ${life} · ${reign}`;
}

/**
 * The line rendered as a GENEALOGY. Roots are members with no parent inside the House; children
 * nest beneath them via childIds. When a House has no recorded kinship (minted records carry no
 * ties), every member is a root — so this same renderer degrades naturally to a plain succession
 * list. A visited set guards against any stray cycle. ⚑ marks the founder, 👑 the living head.
 */
function LineageTree({ members, onRef }: { members: HouseMember[]; onRef: (r: EventRef) => void }) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const roots = members.filter((m) => m.parentIds.length === 0);
  const seen = new Set<number>();
  const node = (m: HouseMember): React.ReactNode => {
    if (seen.has(m.id)) return null;
    seen.add(m.id);
    const kids = m.childIds.map((c) => byId.get(c)).filter((c): c is HouseMember => !!c);
    return (
      <li key={m.id} className="lineage-node">
        <span className="lineage-head">
          {m.isFounder ? <span className="lineage-mark" title="founder of the line"><Icon name="flag" size={0.85} /> </span> : m.isSeat ? <span className="lineage-mark" title="the living head — holds the seat"><Icon name="crown" size={0.85} /> </span> : null}
          <button className="link" onClick={() => onRef({ kind: 'figure', id: m.id })}>{m.name}</button>
          {m.spouses.length > 0 && (
            <span className="muted"> ⚭ {m.spouses.map((s, i) => (
              <Fragment key={s.id}>
                {i > 0 ? ', ' : ''}
                <button className="link" onClick={() => onRef({ kind: 'figure', id: s.id })}>{s.name}</button>
                {s.houseName && s.houseId !== undefined ? <> of <button className="link" onClick={() => onRef({ kind: 'house', id: s.houseId! })}>House {s.houseName}</button></> : null}
              </Fragment>
            ))}</span>
          )}
        </span>
        <span className="muted"> — {memberDates(m)}</span>
        {kids.length > 0 && <ul className="lineage-kids">{kids.map(node)}</ul>}
      </li>
    );
  };
  return <ul className="lineage">{roots.map(node)}</ul>;
}

/**
 * The line as a VISUAL genealogy — a compact generational diagram (nodes + descent lines),
 * shown when a House has real kinship depth. Longest-path depth sets the row; a tidy post-order
 * layout centres each parent over its children. ⚑ founder, 👑 the living head; the departed fade.
 * Rendered as inline SVG (self-contained, theme-aware via CSS), scrolling horizontally if wide.
 */
function LineageDiagram({ members, onRef }: { members: HouseMember[]; onRef: (r: EventRef) => void }) {
  const { NODE_W, NODE_H } = LINEAGE_METRICS;
  const { nodes, edges, width, height } = layoutLineage(members);
  const clip = (s: string) => (s.length > 15 ? s.slice(0, 14) + '…' : s);
  return (
    <div className="dyn-scroll">
      <svg className="dyn-tree" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="dynasty tree">
        {edges.map((e) => <path key={`${e.from}-${e.to}`} className="dyn-edge" d={e.d} />)}
        {members.map((m) => {
          const n = nodes.get(m.id)!;
          const mark = m.isFounder ? '⚑ ' : m.isSeat ? '👑 ' : '';
          const cls = `dyn-node${m.isFounder ? ' founder' : ''}${m.isSeat ? ' head' : ''}${m.deathYear !== undefined ? ' dead' : ''}`;
          return (
            <g key={m.id} className={cls} onClick={() => onRef({ kind: 'figure', id: m.id })} tabIndex={0}
               onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRef({ kind: 'figure', id: m.id }); } }}>
              <title>{`${m.name} — ${memberDates(m)}`}</title>
              <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={5} />
              <text x={n.cx} y={n.y + NODE_H / 2 + 4} textAnchor="middle">{mark}{clip(m.name)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Inspector({
  actorDetail,
  eventChain,
  figureDetail,
  settlementDetail,
  houseDetail,
  cultureDetail,
  deityDetail,
  featureDetail,
  venueDetail,
  settlements,
  playerId,
  nav,
  onPickActor,
  onPickEvent,
  onRef,
  onFocus,
  onPossess,
  onWalk,
  onClose,
}: {
  actorDetail: ActorDetail | null;
  eventChain: EventChain | null;
  figureDetail: FigureDetail | null;
  settlementDetail: SettlementDetail | null;
  houseDetail: HouseDetail | null;
  cultureDetail: CultureDetail | null;
  deityDetail: DeityDetail | null;
  featureDetail: FeatureDetail | null;
  venueDetail: VenueDetail | null;
  settlements: SettlementView[];
  playerId?: number;
  nav?: InspectorNav;
  onPickActor: (id: number) => void;
  onPickEvent: (id: number) => void;
  onRef: (ref: EventRef) => void;
  onFocus: (id: number) => void;
  onPossess: (id: number) => void;
  /** enter a settlement's CLOSE VIEW — walk its streets (ruins welcome). */
  onWalk?: (id: number) => void;
  onClose: () => void;
}) {
  if (!actorDetail && !eventChain && !figureDetail && !settlementDetail && !houseDetail && !cultureDetail && !deityDetail && !featureDetail && !venueDetail) {
    return (
      <section className="panel inspector empty">
        <h2>A closer look</h2>
        <p className="muted">
          Click any <strong>name</strong> in the history — a person or a place — to look closer, or
          click an event and follow <em>why?</em> to trace what led to it.
        </p>
      </section>
    );
  }

  const settV = settlementDetail ? settlements.find((s) => s.id === settlementDetail.settlementId) : undefined;

  // a clickable history line: click a name to inspect it, click the line to trace its causes
  const eventLine = (ev: EventView) => (
    <li key={ev.id}>
      <span
        className="ev-inspect"
        onClick={() => onPickEvent(ev.id)}
        onKeyDown={(e) => onActivate(e, () => onPickEvent(ev.id))}
        role="button"
        tabIndex={0}
      >
        <span className="ev-year">y{ev.year}</span> <EventText parts={ev.parts} onRef={onRef} />
      </span>
    </li>
  );

  return (
    <section className="panel inspector">
      <div className="inspector-head">
        {nav && (
          <span className="inspector-nav">
            <button className="nav-btn" onClick={nav.back} disabled={!nav.canBack} title="back" aria-label="back">
              <Icon name="back" />
            </button>
            <button className="nav-btn" onClick={nav.forward} disabled={!nav.canForward} title="forward" aria-label="forward">
              <Icon name="forward" />
            </button>
          </span>
        )}
        <h2>A closer look</h2>
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
                  ▶ live as
                </button>
              ))}
          </h3>
          <p className="muted">
            {actorDetail.actor.species} {actorDetail.actor.profession} · {actorDetail.actor.ageYears}y ·{' '}
            {actorDetail.actor.sex} · of {actorDetail.actor.houseId !== undefined ? (
              <button className="link" onClick={() => onRef({ kind: 'house', id: actorDetail.actor.houseId! })}>House {actorDetail.actor.house}</button>
            ) : `House ${actorDetail.actor.house}`} · traits:{' '}
            {actorDetail.actor.traits.join(', ') || 'none'}
          </p>
          <p className="muted">Nature: {actorDetail.actor.nature}{actorDetail.actor.faith ? ` · faithful to ${actorDetail.actor.faith}` : ' · faithless'}{actorDetail.actor.factionName ? ` · ${actorDetail.actor.factionName}` : ''}{actorDetail.actor.exiledFrom ? <span className="exile-status"> · exile from {actorDetail.actor.exiledFrom}</span> : null}</p>
          {/* a life-story assembled from their REAL history — who they are, and why */}
          {actorDetail.backstory && <p className="backstory">{actorDetail.backstory}</p>}

          {actorDetail.mood && (
            <>
              <h4>
                Mood: {actorDetail.mood.word} <span className="muted">({actorDetail.mood.value})</span>
              </h4>
              {actorDetail.mood.reasons.length > 0 && (
                <div className="reasons">
                  {actorDetail.mood.reasons.map((why, i) => (
                    <span key={i} className={why.value >= 0 ? 'why-pos' : 'why-neg'}>
                      {why.value >= 0 ? '+' : ''}
                      {why.value} {why.label}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {actorDetail.reputation.reasons.length > 0 && (
            <>
              <h4>
                Standing <span className="muted">({actorDetail.reputation.standing})</span>
              </h4>
              <div className="reasons">
                {actorDetail.reputation.reasons.map((why, i) => (
                  <span key={i} className={why.value >= 0 ? 'why-pos' : 'why-neg'}>
                    {why.value >= 0 ? '+' : ''}
                    {why.value} {why.label}
                  </span>
                ))}
              </div>
            </>
          )}

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
            {figureDetail.role}
            {figureDetail.house ? (
              <> of {figureDetail.houseId !== undefined ? <button className="link" onClick={() => onRef({ kind: 'house', id: figureDetail.houseId! })}>House {figureDetail.house}</button> : `House ${figureDetail.house}`}</>
            ) : ''} of{' '}
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

      {featureDetail && (
        <div>
          <h3>{featureDetail.name}{featureDetail.meaning ? <span className="house-gloss"> · {featureDetail.meaning}</span> : null}</h3>
          <p className="muted">a {featureDetail.kind === 'range' ? 'mountain range' : featureDetail.kind}{featureDetail.settlements.length ? '' : ' · no towns sit beside it'}</p>
          {featureDetail.settlements.length > 0 && (
            <>
              <h4>Towns upon it</h4>
              <ul className="rels">
                {featureDetail.settlements.map((s) => (
                  <li key={s.id}><button className="link" onClick={() => onRef({ kind: 'settlement', id: s.id })}>{s.name}</button></li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {cultureDetail && (
        <div>
          <h3>{cultureDetail.name}</h3>
          <p className="muted">
            {cultureDetail.tongue ? `the ${cultureDetail.tongue.demonym} · a ${cultureDetail.tongue.voice} tongue · ` : ''}
            {cultureDetail.leanings}
            {cultureDetail.patronDeity ? (
              <> · venerate <button className="link" onClick={() => onRef({ kind: 'deity', id: cultureDetail.patronDeity!.id })}>{cultureDetail.patronDeity.name}</button></>
            ) : ''}
          </p>
          {(cultureDetail.creed.reveres.length > 0 || cultureDetail.creed.abhors.length > 0) && (
            <p className="muted">
              {cultureDetail.creed.reveres.length > 0 ? <>reveres {cultureDetail.creed.reveres.join(', ')}. </> : ''}
              {cultureDetail.creed.abhors.length > 0 ? <>abhors {cultureDetail.creed.abhors.join(', ')}.</> : ''}
            </p>
          )}
          {cultureDetail.settlements.length > 0 && (
            <>
              <h4>Its towns</h4>
              <ul className="rels">
                {cultureDetail.settlements.slice(0, 20).map((s) => (
                  <li key={s.id}><button className="link" onClick={() => onRef({ kind: 'settlement', id: s.id })}>{s.name}</button></li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {venueDetail && (
        <div>
          <h3>{venueDetail.name}{venueDetail.meaning ? <span className="house-gloss"> · “{venueDetail.meaning}”</span> : null}</h3>
          <p className="muted">
            a {venueDetail.type} in{' '}
            <button className="link" onClick={() => onRef({ kind: 'settlement', id: venueDetail.settlementId })}>
              {venueDetail.settlement}
            </button>{' '}
            · raised y{venueDetail.foundedYear}
          </p>
          <h4>What happened here</h4>
          {venueDetail.events.length === 0 ? (
            <p className="muted">Nothing of note yet — its stories are still to come.</p>
          ) : (
            <ul className="rels">{venueDetail.events.map(eventLine)}</ul>
          )}
        </div>
      )}

      {deityDetail && (
        <div>
          <h3>{deityDetail.name}</h3>
          <p className="muted">god of {deityDetail.domain} · {deityDetail.faithful} {deityDetail.faithful === 1 ? 'soul holds' : 'souls hold'} this faith</p>
          {deityDetail.cultures.length > 0 && (
            <p className="muted">
              venerated by {deityDetail.cultures.map((c, i) => (
                <span key={c.id}>{i > 0 ? ', ' : ''}<button className="link" onClick={() => onRef({ kind: 'culture', id: c.id })}>{c.name}</button></span>
              ))}
            </p>
          )}
        </div>
      )}

      {houseDetail && (
        <div>
          <h3 className="house-title">
            <HouseShield id={houseDetail.id} name={houseDetail.name} size={30} title={`arms of House ${houseDetail.name}`} />
            <span>House {houseDetail.name}{houseDetail.meaning ? <span className="house-gloss"> · {houseDetail.meaning}</span> : null}</span>
          </h3>
          <p className="muted">
            founded y{houseDetail.foundedYear}
            {houseDetail.founder ? <> by <button className="link" onClick={() => onRef({ kind: 'figure', id: houseDetail.founder!.id })}>{houseDetail.founder.name}</button></> : ''}
            {houseDetail.originId !== undefined ? <> in <button className="link" onClick={() => onRef({ kind: 'settlement', id: houseDetail.originId! })}>{houseDetail.origin}</button></> : houseDetail.origin ? ` in ${houseDetail.origin}` : ''}
            {` · ${houseDetail.prestige} renown`}
          </p>
          <p className="muted">
            {houseDetail.extinctYear !== undefined ? (
              `a fallen line — ended y${houseDetail.extinctYear}`
            ) : houseDetail.seatId !== undefined ? (
              <>rules <button className="link" onClick={() => onRef({ kind: 'settlement', id: houseDetail.seatId! })}>{houseDetail.seat}</button></>
            ) : 'out of power, its dynasty enduring in name'}
          </p>
          {houseDetail.members.length > 0 && (
            <>
              <h4>The line</h4>
              {/* a real dynasty (recorded kinship) reads best as a diagram; a bare succession
                  line — the common case for minted rulers — stays a scannable list. */}
              {houseDetail.members.some((m) => m.childIds.length > 0) ? (
                <LineageDiagram members={houseDetail.members} onRef={onRef} />
              ) : (
                <LineageTree members={houseDetail.members} onRef={onRef} />
              )}
            </>
          )}
          <h4>The House’s saga</h4>
          {houseDetail.events.length === 0 ? (
            <p className="muted">Nothing recorded.</p>
          ) : (
            <ul className="rels">{houseDetail.events.map(eventLine)}</ul>
          )}
        </div>
      )}

      {settlementDetail && (
        <div>
          <h3>{settV?.name ?? 'Settlement'}</h3>
          {settV?.nameMeaning && <p className="name-gloss">“{settV.nameMeaning}”, in the founders’ tongue</p>}
          {settV?.landmark && (
            <p className="name-gloss">
              {settV.landmark.relation}{' '}
              {settV.landmark.featureIndex !== undefined ? (
                <button className="link" onClick={() => onRef({ kind: 'feature', id: settV.landmark!.featureIndex! })}>{settV.landmark.name}</button>
              ) : settV.landmark.name}
            </p>
          )}
          {settV && (
            <p className="muted">
              {settV.ruinedYear !== undefined
                ? `a ruin · fell y${settV.ruinedYear}`
                : `${settV.population} souls · ${settV.dominantSpecies} · ${settV.specialization}`}
              {' · '}
              <button className="link" onClick={() => onRef({ kind: 'culture', id: settV.cultureId })}>{settV.culture}</button>
              {settV.leaderTitle && settV.ruler ? (
                <>
                  {' · '}{settV.leaderTitle}{' '}
                  {settV.rulerId !== undefined ? (
                    <button className="link" onClick={() => onRef({ kind: 'figure', id: settV.rulerId! })}>{settV.ruler}</button>
                  ) : settV.ruler}
                </>
              ) : !settV.leaderTitle ? ' · free folk' : ''}
            </p>
          )}
          {settV?.polity && (
            <p className="polity">
              governed by the <em>{settV.polity.name}</em>
              {settV.polity.leaderName ? (
                <> · led by {settV.polity.leaderId !== undefined ? <button className="link" onClick={() => onRef({ kind: 'figure', id: settV.polity!.leaderId! })}>{settV.polity.leaderName}</button> : settV.polity.leaderName}</>
              ) : ''}
              {settV.polity.founderName ? (
                <> · founded by {settV.polity.founderId !== undefined ? <button className="link" onClick={() => onRef({ kind: 'figure', id: settV.polity!.founderId! })}>{settV.polity.founderName}</button> : settV.polity.founderName}</>
              ) : ''}
              {settV.polity.leaderCount > 1 ? ` · ${settV.polity.leaderCount} leaders in its line` : ''}
              {` · treasury ${settV.polity.treasury}`}
            </p>
          )}
          {settV?.polity?.reasoning && (
            <div className="polity-reasoning">
              <p className="reasoning-line">
                <span className="muted">worldview:</span> {settV.polity.reasoning.worldview}
                {' · '}
                <span className="muted">intent:</span> <strong>{settV.polity.reasoning.intent}</strong>{' '}
                <span className="muted">({settV.polity.reasoning.score})</span>
              </p>
              <p className="reasoning-why muted">{settV.polity.reasoning.intentDescription}</p>
              <ul className="reasoning-factors">
                {settV.polity.reasoning.factors.map((f, i) => (
                  <li key={i}>
                    {f.group ? <span className="muted">{f.group}: </span> : null}
                    {f.label} <span className={f.value >= 0 ? 'pos' : 'neg'}>{f.value >= 0 ? `+${f.value}` : f.value}</span>
                  </li>
                ))}
              </ul>
              {settV.polity.reasoning.alternatives.length > 0 && (
                <p className="reasoning-alts muted">
                  also weighed: {settV.polity.reasoning.alternatives.map((a) => `${a.label} (${a.score})`).join(' · ')}
                </p>
              )}
              <details className="reasoning-perception">
                <summary className="muted">what it knows</summary>
                <ul>
                  {settV.polity.reasoning.perception.map((p, i) => (
                    <li key={i}>
                      {p.label}: {p.value} <span className="muted">({Math.round(p.confidence * 100)}% sure)</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          {settV?.polity?.operational && (
            <p className="polity-operational muted">
              {Object.entries(settV.polity.operational).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}
              {settV.polity.lastAction ? ` — last: ${settV.polity.lastAction.summary} (y${settV.polity.lastAction.year})` : ''}
            </p>
          )}
          {settV?.polity && (settV.polity.agreements.length > 0 || settV.polity.lastInteraction) && (
            <p className="polity-diplomacy muted">
              {settV.polity.agreements.length > 0
                ? `sworn: ${settV.polity.agreements.map((g) => `${g.kind === 'non_aggression' ? 'peace' : 'trade'} with ${g.with} (to y${g.untilYear})`).join(' · ')}`
                : ''}
              {settV.polity.lastInteraction
                ? `${settV.polity.agreements.length > 0 ? ' — ' : ''}${settV.polity.lastInteraction.summary} (y${settV.polity.lastInteraction.year})`
                : ''}
            </p>
          )}
          {settV?.patronDeity && (
            <p className="patron-deity">sacred to: <button className="link" onClick={() => onRef({ kind: 'deity', id: settV.patronDeity.id })}><em>{settV.patronDeity.name}</em></button> · {settV.patronDeity.domain}</p>
          )}
          {settV?.creed && (settV.creed.reveres.length > 0 || settV.creed.abhors.length > 0) && (
            <p className="creed">
              {settV.creed.reveres.length > 0 && <>reveres <span className="creed-reveres">{settV.creed.reveres.join(' · ')}</span></>}
              {settV.creed.reveres.length > 0 && settV.creed.abhors.length > 0 && <span className="creed-sep"> · </span>}
              {settV.creed.abhors.length > 0 && <>abhors <span className="creed-abhors">{settV.creed.abhors.join(' · ')}</span></>}
            </p>
          )}
          {settV?.factionSplit && (
            <p className="faction-split">divided over <em>{settV.factionSplit.axis}</em>: <span className="faction-high">{settV.factionSplit.highName}</span> vs <span className="faction-low">{settV.factionSplit.lowName}</span></p>
          )}
          {settV?.civilWarYear !== undefined && (
            <p className="civil-war-tension">⚔ in civil conflict since year {settV.civilWarYear}</p>
          )}
          {settV && !settV.detailed && settV.ruinedYear === undefined && (
            <button className="play-inline" onClick={() => onFocus(settlementDetail.settlementId)}>
              ◉ turn your gaze here
            </button>
          )}
          {onWalk && (
            <button className="play-inline" onClick={() => onWalk(settlementDetail.settlementId)} title="see this place up close">
              walk its streets
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
              <h4>Caused by</h4>
              {/* the causal ancestry as a TREE — each cause indented under what it explains,
                  and itself clickable to re-root the "why?" there and walk further back. */}
              <ul className="cause-tree">
                {eventChain.ancestors.map((c) => (
                  <li key={c.event.id} className="cause-node" style={{ paddingLeft: `${(c.depth - 1) * 16}px` }}>
                    <span className="cause-arrow" aria-hidden>↳</span>
                    <span
                      className="ev-inspect"
                      onClick={() => onPickEvent(c.event.id)}
                      onKeyDown={(e) => onActivate(e, () => onPickEvent(c.event.id))}
                      role="button"
                      tabIndex={0}
                      title="trace this cause's causes"
                    >
                      <span className="ev-year">y{c.event.year}</span> <EventText parts={c.event.parts} onRef={onRef} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
