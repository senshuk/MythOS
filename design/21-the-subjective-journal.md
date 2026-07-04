# The Subjective Journal — the UI north star

**Document type:** Presentation-layer constitution — how the player HUD is written.
**Companion documents:** `18-prime-movers.md` (objective vs. subjective), `11-simulation-ontology.md` (§Mark laws), `17-epistemics-adr.md`. Implementation: `poc/src/ui/App.tsx` (the player panel), `poc/src/engine/sim.ts` (the snapshot builders).
**Status:** Canonical for the player-facing UI.

---

## The north star

> ## Every panel is written from inside the player's head, never from the engine's perspective.

The engine is objective; the journal must never stop being **subjective**. It is the place where the player inhabits *one mind* inside an objective world — a much rarer design space than "a simulation with character stats."

| Never (the engine's view) | Always (the character's view) |
|---|---|
| `Relationship: 82` | *Thlaaeth has become one of the people you trust most.* |
| `News arrival: 12 days` | *You're waiting to hear from Krypa.* |
| `Belief confidence 0.91` | *You're certain Aeriril rules Teder.* |
| `succession_settled: 0` | *No one seems sure who truly rules.* |

## The law beneath it (the UI twin of the epistemic laws)

> ## The journal reveals what the character could THINK, never what the engine KNOWS.

This is the presentation-layer echo of *"observation does not constitute history"* (`15` inv. 8) and *"only witnesses create Evidence"* (`11` §Mark). A panel must never surface a fact **because the engine has it** — only because **the character could hold it**. That discipline is what keeps the journal from decaying into another inspector: it is a window onto one subjective reality, not a readout of the objective one. Where the two diverge is exactly where the drama lives.

**"What you know," not "what you believe."** Belief is the implementation; *knowing* is the experience. People don't think in confidences and beliefs — they think in what they know. When their knowledge is later proven wrong, they experience *misinformation*, which is precisely how the epistemics should feel from the inside.

## The journal is a cognition pipeline, not a set of peer panels

The sections are ordered as a mind actually works — and this ordering is deliberate:

```
WHO MATTERS      people  ─── the anchors you care about
    ↓
WHAT'S HAPPENING events  ─── what's changing around you
    ↓
WHAT YOU KNOW    interpret ── your subjective grasp of it (can be wrong)
    ↓
OPPORTUNITIES / THREATS  choose ── what you could do / should fear
    ↓
YOUR STORY       memory  ─── what it all became
```

People matter → events happen → you interpret them → you choose → later they are memory. Past (Your Story), present (What's Happening / What You Know), future (Opportunities / Threats). The HUD is a temporal model of a life.

## Two shapes this mandates

- **The goal is a diagnosis, not a quest.** The engine already knows why the player is failing; say it. *"In your way: Aeriril still holds the seat. Best move: raise your standing."* Plus a coarse progress sense. Never a checklist — a reading of the character's situation.
- **Your Story is an autobiography in the making.** Milestones, not a log (icons, no ticks). At ninety it should read as a life — *married, raised four children, survived the famine, became mayor, ended the border war, died peacefully.* A natural future step is to let a local LLM rewrite those milestones into a readable memoir (presentation only, never the deterministic core — `AI Philosophy`).

## The sentence that does the most work

> **No word has reached you from Krypa.**

Most games either reveal information or hide it. MythOS says a third thing: *there is news; you simply haven't heard it.* The world contains information that exists **independently of the player** — the UI face of the observer-independence north star (`18`) and the News Frontier (`20`). Protect that sentence; it is where the journal stops being a dashboard and becomes a place you inhabit.

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-04 | Initial UI constitution. The north star (*every panel written from inside the player's head*) and its underlying law (*reveal what the character could think, never what the engine knows* — the UI twin of the epistemic laws). "What you know" over "what you believe". The journal as a cognition pipeline (who matters → happening → know → opportunities/threats → story = people → events → interpret → choose → remember). Goal-as-diagnosis; Your-Story-as-autobiography (future LLM memoir). Protects the observer-independence sentence "no word has reached you from Krypa". |
