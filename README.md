# MythOS

**A browser-based fictional-universe simulation engine** — a living world where stories
*emerge* from interacting systems rather than being scripted. It is not an RPG, a
kingdom-management game, or a story generator. The player enters a world that already
exists and continues with or without them.

The guiding design principles (simulation first, world before player, every character
equal, everything is data, deterministic over random) live in [claude.md](claude.md).

## Repository layout

| Path | What's there |
|---|---|
| **[`poc/`](poc/)** | The **proof-of-concept** — a deterministic, worker-isolated ECS simulation + React UI: a "Living Village" that grows a deep, legible history. Start here. See [`poc/README.md`](poc/README.md). |
| **[`design/`](design/)** | The **design dossier** — architecture, data model, simulation systems, modules/universe packs, roadmap, plus studies of Warsim, RimWorld, and Dwarf Fortress and how their lessons fold in. |
| [`claude.md`](claude.md) | Project vision & design philosophy. |

## The proof-of-concept, in brief

A deterministic simulation (seeded RNG, no wall-clock/`Math.random`) runs in a Web Worker;
the UI sends intents and renders snapshots. It demonstrates:

- **Level-of-detail simulation** — one focused settlement runs per-actor; named people
  elsewhere are tracked coarsely; the rest of the world evolves as aggregate populations.
  Live-entity count stays bounded no matter how large the world grows.
- **Emergent, legible history** — relationships as decaying sourced thoughts, a fading
  Chronicle plus a permanent Annals of named ages and legends, ruling dynasties, wars,
  wonders, beasts, plagues, trade, and migration — each event traceable to its causes.
- **Worldgen pre-history** — forge a world with centuries of named history, ruins, and
  dynasties, *then* drop the player into a settlement that already exists.

```bash
cd poc
npm install
npm run dev     # open http://localhost:5173
npm test        # determinism + simulation gate
```

## Status

Early proof-of-concept under active development. The simulation engine is intentionally
**universe-agnostic** — specific settings (species, cultures, governments, etc.) are meant
to live in data-driven *Universe Packs*, not in the engine.

## Acknowledgements

Design studies reference **Warsim**, **RimWorld**, and **Dwarf Fortress** for their
emergent-storytelling principles. Those games are the property of their respective
creators; only design *patterns* are studied here — no game assets or code are included
in this repository.
