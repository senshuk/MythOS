/**
 * The player cockpit: ambitions and decisions, the current-situation read, the
 * attention feed, your subjective world-view, and the reflective journal. One
 * panel that reads top-to-bottom like a thought (design/21).
 */
import { useState, useRef, useEffect } from 'react';
import type { EventRef, PlayerView, Tension, DecisionView, ActiveAmbitionView, AmbitionOffer, StoryBeat } from '../engine/model';
import type { Intent } from '../engine/intent';
import { TYPE_TONE, onActivate, EventText, useStableOrder } from './common';
import { Glyph, Icon, TONE_ICON } from './icons';

/** A story beat's icon, from the shared drawn set (used to be emoji). */
const beatIcon = (tone: string) => <Icon name={TONE_ICON[tone] ?? 'dot'} />;

/** THE WEEK ANSWERS BACK (design/26 P6): every action (or held year) should land as a
 *  reply, not a silent snapshot swap. This tracks which of the player's story beats are
 *  NEW since we last cleared, purely in the presentation layer — the engine stays a pure
 *  read. A new life (playerId change) re-baselines to the whole story so an inherited
 *  soul isn't greeted by a flood of a life it didn't live. `clear()` is called the moment
 *  the player acts, so the strip that follows is exactly "what this deed became". */
const beatKey = (b: StoryBeat) => `${b.year}|${b.tone}|${b.parts.map((p) => p.text).join('')}`;
function useFreshBeats(playerId: number, story: StoryBeat[]) {
  const seen = useRef<Set<string>>(new Set());
  const lastPlayer = useRef<number | undefined>(undefined);
  const [fresh, setFresh] = useState<StoryBeat[]>([]);
  useEffect(() => {
    if (lastPlayer.current !== playerId) {
      lastPlayer.current = playerId;
      seen.current = new Set(story.map(beatKey)); // baseline the new life; announce nothing
      setFresh([]);
      return;
    }
    const added: StoryBeat[] = [];
    for (const b of story) {
      const k = beatKey(b);
      if (!seen.current.has(k)) { seen.current.add(k); added.push(b); }
    }
    if (added.length) setFresh((prev) => [...prev, ...added].slice(-6)); // keep the strip compact
  }, [playerId, story]);
  return { fresh, clear: () => setFresh([]) };
}

/** The compact "what your week (or year) became" strip — the beats that touched YOU since you
 *  last acted, rendered where you'll see the reply the instant it lands. Dismissable. */
function WeekAnswer({ beats, onRef, onDismiss }: { beats: StoryBeat[]; onRef: (ref: EventRef) => void; onDismiss: () => void }) {
  if (beats.length === 0) return null;
  return (
    <div className="week-answer" role="status">
      <div className="wa-head">
        <span className="wa-tag">Since last you looked</span>
        <button className="link wa-dismiss" onClick={onDismiss} title="dismiss">×</button>
      </div>
      <ul className="wa-beats">
        {beats.slice().reverse().map((b, i) => (
          <li key={i} className={`ev ${TYPE_TONE[b.tone] ?? 'neutral'}`}>
            <span className="beat-icon" aria-hidden="true">{beatIcon(b.tone)}</span> <EventText parts={b.parts} onRef={onRef} />
            {b.note && <span className="muted"> — {b.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A framed choice with option buttons — shared by the world's decisions and an ambition's next
 *  step. Each option is an Intent taken through the normal player turn. */
function DecisionCard({ d, onAct, onRef, busy }: { d: DecisionView; onAct: (i: Intent) => void; onRef: (r: EventRef) => void; busy: boolean }) {
  return (
    <div className="decision-card">
      <p className="decision-prompt">
        <EventText parts={d.prompt} onRef={onRef} />
      </p>
      <div className="decision-options">
        {d.options.map((o, i) => (
          <button
            key={i}
            className={`decision-opt tone-${o.tone ?? 'neutral'}${o.nature?.against ? ' against-nature' : ''}`}
            onClick={() => onAct(o.intent)}
            disabled={busy}
            title={[o.hint, o.nature && (o.nature.against ? 'this would weigh on your conscience' : 'this is true to who you are')].filter(Boolean).join(' · ')}
          >
            {o.label}
            {/* how it sits with the player's OWN convictions (design/26 P3) */}
            {o.nature && (
              <span className={`opt-nature${o.nature.against ? ' against' : ''}`}>
                {o.nature.against ? `${o.nature.word} · against your nature` : o.nature.word}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The player's self-chosen through-line: the committed ambition with its live step (or closing
 *  outcome), and — when none is active or one has just resolved — the ambitions on offer. */
function AmbitionBanner({
  ambition,
  offered,
  onAct,
  onRef,
  onChoose,
  onAbandon,
  busy,
}: {
  ambition?: ActiveAmbitionView;
  offered: AmbitionOffer[];
  onAct: (i: Intent) => void;
  onRef: (r: EventRef) => void;
  onChoose: (id: string, target?: number) => void;
  onAbandon: () => void;
  busy: boolean;
}) {
  const resolved = ambition?.outcome !== undefined;
  return (
    <div className="ambition">
      {ambition && (
        <div className={`ambition-active${resolved ? ` amb-${ambition.outcome}` : ''}`}>
          <div className="ambition-head">
            <span className="amb-tag"><Icon name="flag" size={0.9} /> Ambition</span>
            <span className="amb-label">{ambition.label}</span>
            {!resolved && (
              <button className="link amb-abandon" onClick={onAbandon} disabled={busy} title="let this ambition go">
                give up
              </button>
            )}
          </div>
          {resolved ? (
            <p className="amb-outcome">
              {ambition.outcome === 'fulfilled' ? '✓ You achieved it.' : '✗ It slipped beyond your reach.'} {ambition.note}
            </p>
          ) : (
            <>
              <p className="amb-note muted">{ambition.note}</p>
              {ambition.step && <DecisionCard d={ambition.step} onAct={onAct} onRef={onRef} busy={busy} />}
            </>
          )}
        </div>
      )}
      {offered.length > 0 && (
        <div className="ambition-choose">
          <span className="amb-tag"><Icon name="flag" size={0.9} /> {ambition ? 'Set your next ambition' : 'What will you make of this life?'}</span>
          <div className="amb-offers">
            {offered.map((o) => (
              <button key={o.id} className="amb-offer" onClick={() => onChoose(o.id, o.target)} disabled={busy} title={o.hint}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A block of live threads — present tensions, beliefs, opportunities, or worries. Each is a short
 *  line, clickable when it points at a person. Hidden when empty unless an `emptyText` is given. */
function Threads({ head, items, onRef, emptyText }: { head: string; items: Tension[]; onRef: (ref: EventRef) => void; emptyText?: string }) {
  if (items.length === 0 && !emptyText) return null;
  return (
    <div className="whats-happening">
      <h4 className="wh-head">{head}</h4>
      {items.length === 0 ? (
        <p className="thread-empty muted">{emptyText}</p>
      ) : (
      <ul className="tensions">
        {items.map((t, i) => (
          <li key={i} className="tension">
            <span className="t-icon" aria-hidden="true"><Glyph glyph={t.icon} /></span>{' '}
            {t.ref ? (
              <span
                className="ev-inspect"
                role="button"
                tabIndex={0}
                onClick={() => onRef(t.ref!)}
                onKeyDown={(e) => onActivate(e, () => onRef(t.ref!))}
              >
                {t.text}
              </span>
            ) : (
              <span>{t.text}</span>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

/** YOUR VIEW OF THE WORLD — the player's own subjective reality, elevated as the thesis it is.
 *  Certainty (what you KNOW) is set visually apart from absence of knowledge (news not yet
 *  arrived) and, later, contested claims and rumor (design/21 §3–4). */
function WorldView({ items, onRef }: { items: Tension[]; onRef: (ref: EventRef) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="worldview">
      <h4 className="wv-head">Your world</h4>
      <ul className="wv-list">
        {items.map((t, i) => (
          <li key={i} className={`wv-item c-${t.certainty ?? 'known'}`}>
            <span className="wv-icon" aria-hidden="true"><Glyph glyph={t.icon} /></span>{' '}
            {t.ref ? (
              <span
                className="ev-inspect"
                role="button"
                tabIndex={0}
                onClick={() => onRef(t.ref!)}
                onKeyDown={(e) => onActivate(e, () => onRef(t.ref!))}
              >
                {t.text}
              </span>
            ) : (
              <span>{t.text}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** WHAT DESERVES MY ATTENTION — one feed, sorted by importance, notification-style. People, changes,
 *  openings and worries merged (design/21 §7). Where a line has an obvious response, the verb sits
 *  ON the notification (CK's action items) and flows through the ordinary player turn. */
function Attention({ items, onRef, onAct, busy }: { items: Tension[]; onRef: (ref: EventRef) => void; onAct: (i: Intent) => void; busy: boolean }) {
  // hold each notification's row while it survives — re-ranking every streamed
  // year would make the cockpit read as churn (keyed by text: tensions carry no id)
  const stable = useStableOrder(items, (t) => `${t.icon}:${t.text}`);
  if (items.length === 0) return null;
  return (
    <div className="attention">
      <h4 className="wh-head">What deserves your attention</h4>
      <ul className="att-list">
        {stable.map((t, i) => (
          <li key={i} className="att-item">
            <span className="att-icon" aria-hidden="true"><Glyph glyph={t.icon} /></span>
            {t.ref ? (
              <span
                className="ev-inspect"
                role="button"
                tabIndex={0}
                onClick={() => onRef(t.ref!)}
                onKeyDown={(e) => onActivate(e, () => onRef(t.ref!))}
              >
                {t.text}
              </span>
            ) : (
              <span>{t.text}</span>
            )}
            {t.action && (
              <button
                className="att-act"
                onClick={() => onAct(t.action!.intent)}
                disabled={busy}
                title={`${t.action.label} — spends your week, like any action`}
              >
                {t.action.label} ▸
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** THE JOURNAL — reflective, not actionable: the full categorized streams and your life so far.
 *  Behind one click so the cockpit stays a cockpit (design/21 §6). Story lives here — nobody
 *  deciding what to do this week needs their wedding from 40 years ago. */
function Journal({ player, onRef }: { player: PlayerView; onRef: (ref: EventRef) => void }) {
  return (
    <details className="journal">
      <summary className="journal-head">Open the journal</summary>
      <div className="journal-body">
        <Threads head="What's changing around you" items={player.tensions} onRef={onRef} />
        <Threads head="What could change your life" items={player.opportunities} onRef={onRef} emptyText="Nothing obvious right now." />
        <Threads head="What might go wrong" items={player.threats} onRef={onRef} />
        {player.story.length > 0 && (
          <div className="whats-happening">
            <h4 className="wh-head">Your story so far</h4>
            <ul className="story-beats">
              {player.story.slice(-12).reverse().map((b, i) => (
                <li key={i} className={`ev ${TYPE_TONE[b.tone] ?? 'neutral'}`}>
                  <span className="beat-icon" aria-hidden="true">{beatIcon(b.tone)}</span> <EventText parts={b.parts} onRef={onRef} />
                  {b.note && <span className="muted"> — {b.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function PlayerPanel({
  player,
  onAct,
  onRelease,
  onInherit,
  onInspect,
  onRef,
  onChooseAmbition,
  onAbandonAmbition,
  busy,
}: {
  player: PlayerView;
  onAct: (intent: Intent) => void;
  onRelease: () => void;
  onInherit: () => void;
  onInspect: (id: number) => void;
  onRef: (ref: EventRef) => void;
  onChooseAmbition: (id: string, target?: number) => void;
  onAbandonAmbition: () => void;
  busy: boolean;
}) {
  const [actionKind, setActionKind] = useState<PlayerView['actions'][number]['kind']>('work');
  const [targetId, setTargetId] = useState<number | ''>('');

  // THE WEEK ANSWERS BACK (P6): track the beats that arrive after each deed. Every action
  // clears the strip first, so what follows reads as the reply to *this* choice.
  const { fresh, clear: clearWeek } = useFreshBeats(player.id, player.story);
  const act = (intent: Intent) => { clearWeek(); onAct(intent); };

  const action = player.actions.find((a) => a.kind === actionKind) ?? player.actions[0];
  const needsTarget = action.needsTarget;
  useEffect(() => {
    if (!player.actions.some((a) => a.kind === actionKind)) {
      setActionKind(player.actions[0].kind);
      setTargetId('');
    }
  }, [actionKind, player.actions]);
  useEffect(() => {
    if (targetId !== '' && !player.targets.some((t) => t.id === targetId)) setTargetId('');
  }, [targetId, player.targets]);
  const canAct = player.alive && !busy && (!needsTarget || targetId !== '');

  const submit = () => {
    if (!canAct) return;
    const intent: Intent = needsTarget
      ? ({ kind: action.kind, target: Number(targetId) } as Intent)
      : ({ kind: action.kind } as Intent);
    act(intent);
  };

  return (
    <section className="panel player-panel">
      <div className="player-head">
        <div>
          <span className="player-tag"><Icon name="play" size={0.85} /> Playing as</span>{' '}
          <button className="link strong" onClick={() => onInspect(player.id)}>
            {player.name}
          </button>{' '}
          <span className="muted">
            — {player.species} {player.profession}, {player.ageYears}y · {player.settlement}
          </span>
        </div>
        <button className="link" onClick={onRelease} disabled={busy} title="stop living this life; keep watching the world">
          step out of this life
        </button>
      </div>
      {player.alive && <WeekAnswer beats={fresh} onRef={onRef} onDismiss={clearWeek} />}

      {!player.alive ? (
        // DEATH AS A TRANSITION — the Dynasty step. If the line has an heir, the story
        // is theirs to continue; only when no kin remains does it truly end here.
        <div className="player-dead">
          <p>
            You died{player.deathYear !== undefined ? ` in year ${player.deathYear}` : ''}.
          </p>
          {player.succession ? (
            <>
              <p>
                {player.succession.offer.pre}
                <button className="link strong" onClick={() => onInspect(player.succession!.heirId)}>
                  {player.succession.heirName}
                </button>
                {', '}
                {player.succession.relation}
                {player.succession.offer.post}
                {player.succession.awayNote && <span className="muted"> {player.succession.awayNote}</span>}
              </p>
              <button className="btn btn-primary" onClick={onInherit} disabled={busy}>
                Continue as {player.succession.heirName}
              </button>
            </>
          ) : (
            <p>
              {player.lineEnds ?? 'The world goes on without you.'}{' '}
              <span className="muted">Release to keep watching, or advance time.</span>
            </p>
          )}
        </div>
      ) : (
        <>
          <AmbitionBanner
            ambition={player.ambition}
            offered={player.offeredAmbitions}
            onAct={act}
            onRef={onRef}
            onChoose={onChooseAmbition}
            onAbandon={onAbandonAmbition}
            busy={busy}
          />
          {player.decisions.length > 0 && (
            <div className="decisions" aria-label="the world asks">
              {player.decisions.map((d) => (
                <DecisionCard key={d.id} d={d} onAct={act} onRef={onRef} busy={busy} />
              ))}
            </div>
          )}
          {player.lastAchieved && <div className="achieved">✓ {player.lastAchieved}</div>}

          {/* THE DOMINANT QUESTION — the one thing that should make you press Advance.
              A narrator's reading of where you stand, not a quest tracker (design/21 §1–2). */}
          <div className="situation">
            {/* the derived aspiration narration shows only when no ambition is committed —
                otherwise the ⚑ ambition (above) IS the goal, and this is just the free-action tail. */}
            {!player.ambition && (
              <>
                <div className="situation-head">
                  <span className="situation-tag">Current situation</span>
                  {player.aspiration.suggested && (
                    <button
                      className="act-btn goal-pursue"
                      onClick={() => act(player.aspiration.suggested!)}
                      disabled={busy}
                      title="take the action your character is driven toward"
                    >
                      Pursue ▸
                    </button>
                  )}
                </div>
                <p className="situation-aim">{player.aspiration.label}</p>
                {player.aspiration.obstacle && <p className="situation-read">{player.aspiration.obstacle}</p>}
              </>
            )}
            {/* MOOD — how this life feels, with every reason on hover (mood.ts) */}
            <p
              className={`situation-mood ${player.mood.value < 250 ? 'mood-bad' : player.mood.value < 400 ? 'mood-warn' : player.mood.value < 600 ? '' : 'mood-good'}`}
              title={player.mood.reasons.map((r) => `${r.value >= 0 ? '+' : ''}${r.value} ${r.label}`).join('\n')}
            >
              Spirits: {player.mood.word.toLowerCase()}
            </p>
            {player.bodyNote && <p className="situation-body">{player.bodyNote}</p>}
            {!player.ambition && player.aspiration.progress !== undefined && (
              <div className="goal-progress" title={`${Math.round(player.aspiration.progress * 100)}% of the way`}>
                <div className="goal-progress-fill" style={{ width: `${Math.round(player.aspiration.progress * 100)}%` }} />
              </div>
            )}
            {!player.ambition && player.aspiration.nextStep && (
              <p className="situation-step"><span className="step-label">Best next step</span> {player.aspiration.nextStep}</p>
            )}

            {/* the action belongs right here — the page should read top-to-bottom like a thought:
                here's where I stand, so here's what I'll do (design/21 §7). With a committed ambition
                (whose step shows above), the derived-goal read is hidden and this is the free tail. */}
            {player.ambition && <span className="situation-tag act-lead">Or — do something else</span>}
            {/* The situated affordances (Pursue, the world's decisions, the attention verbs)
                lead; the raw action form is the FALLBACK (design/26 P6). The primary button
                just lives the week at the chosen deed — the target picker no longer sits
                always-open on the page but folds into "act on your own" below. */}
            <div className="action-bar">
              <button className="act-btn act-primary" onClick={submit} disabled={!canAct}>
                {action.label} ▸ live the week
              </button>
              <span className="muted action-hint">{action.hint}</span>
            </div>
            <details className="action-choose">
              <summary className="action-choose-head">Act on your own — choose a deed{needsTarget ? ', and whom' : ''}</summary>
              <div className="action-form">
                <select
                  value={actionKind}
                  onChange={(e) => { setActionKind(e.target.value as typeof actionKind); setTargetId(''); }}
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
              </div>
            </details>
            {/* the AUTOPILOT (design/26 P1), told plainly: acting seizes a week; unseized
                weeks are lived by the character's own nature while the years run */}
            <p className="autopilot-note muted">
              Weeks you don't seize, {player.name.split(' ')[0]} lives by their own nature — press ▶ and watch.
            </p>
          </div>

          {/* QUESTION 2 — one feed, people and events merged, sorted by importance. */}
          <Attention items={player.attention} onRef={onRef} onAct={act} busy={busy} />

          {/* QUESTION 3 — what you currently believe to be true. Everything else is one click away. */}
          <WorldView items={player.belief} onRef={onRef} />
          <Journal player={player} onRef={onRef} />
        </>
      )}

      {!player.alive && player.story.length > 0 && (
        <details className="player-story" open>
          <summary className="story-head">Your story so far</summary>
          <ul className="story-beats">
            {player.story.slice(-12).reverse().map((b, i) => (
              <li key={i} className={`ev ${TYPE_TONE[b.tone] ?? 'neutral'}`}>
                <span className="beat-icon" aria-hidden="true">{beatIcon(b.tone)}</span> <EventText parts={b.parts} onRef={onRef} />
                {b.note && <span className="muted"> — {b.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
