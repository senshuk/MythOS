/**
 * The world panel: the world-scale digest, the focused place's vitals and notable
 * folk, the settlement selector, and the storyteller. The map itself lives on the
 * stage (App) — this panel is everything ABOUT the world that isn't the map.
 */
import { useState } from 'react';
import type { Snapshot } from '../engine/model';
import { Icon } from './icons';

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

export function WorldPanel({
  stat,
  onPickActor,
  onFocus,
  onSetStoryteller,
  onPossess,
  busy,
}: {
  stat: Snapshot;
  onPickActor: (id: number) => void;
  onFocus: (id: number) => void;
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

      <section className="focus-panel">
        <h3>{stat.settlementName} · where your gaze rests</h3>
        <div className="stats">
          <Stat label="Souls" value={stat.population} />
          <Stat label="Births" value={stat.totalBorn} />
          <Stat label="Deaths" value={stat.totalDied} />
          <Stat label="Marriages" value={stat.marriages} />
          <Stat label="Feuds" value={stat.feuds} />
        </div>
        <h4 className="live-as-head">Notable folk — press <Icon name="play" size={0.8} /> to live one of their lives</h4>
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
                {a.id === stat.player?.id ? <Icon name="focus" /> : <Icon name="play" />}
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
                  {s.dominantSpecies} · {s.specialization} · <span title={`wealth ${s.wealth}`}>{s.wealth}w</span> ·{' '}
                  <span
                    className={subsistenceClass(s.subsistenceSecurity)}
                    title={`${s.subsistenceSecurity.toFixed(2)} years of staple stores per soul`}
                  >
                    {subsistenceLabel(s.subsistenceSecurity)}
                  </span>
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
        <div className="tension-bar" title={`tension ${stat.director.tension} of 200 — the gathering temper of the age`}>
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
