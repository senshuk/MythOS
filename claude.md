# CLAUDE.md

# MythOS

**MythOS** is a browser-based fictional universe simulation engine.

It is **not** a traditional RPG.

It is **not** a kingdom management game.

It is **not** a story generator.

It is a living world simulation where stories naturally emerge from interacting systems.

---

# Project Vision

MythOS simulates an entire fictional universe.

The player does not create the world.

The player enters a world that already exists.

The simulation continues regardless of player actions.

History is continuously being created.

The player is simply one participant.

There is no concept of a "main character."

---

# Design Philosophy

## Simulation First

Every gameplay feature must originate from simulation.

Avoid scripted events whenever possible.

The simulation should answer questions such as:

* Who rules this kingdom?
* Why did this city become wealthy?
* Why did the empire collapse?
* Why is this road abandoned?
* Why does this merchant hate another merchant?

The UI presents the results.

The simulation creates them.

---

## World Before Player

The world exists independently.

The player should never feel like the universe revolves around them.

Examples:

* Kingdoms wage war without player involvement.
* NPCs marry.
* NPCs have children.
* NPCs inherit property.
* Businesses open and fail.
* Religions evolve.
* Trade routes appear and disappear.

If the player dies:

The simulation continues.

There is no win state and no lose state.

Death is a transition, not a game over — inherit an heir, or follow another life.

The world is the point, not the player's survival.

---

## Every Character Is Equal

The player is simply controlling one Actor.

There should never be separate code paths for:

* Player
* NPC

Every character follows identical simulation rules.

The only difference is:

controlledByPlayer = true

This keeps the simulation consistent and greatly simplifies AI.

---

## Emergent Gameplay

Prefer systems over content.

Instead of writing:

"If player steals horse..."

Create systems for:

* Crime
* Witnesses
* Reputation
* Ownership
* Guards
* Laws
* Memory

Interesting stories should emerge naturally.

---

## Legibility

A simulation is only as good as what the player can understand of it.

A world that generates deep history no one can follow has failed.

This is the opposite failure from scripting, and just as fatal.

The player must always be able to ask "why did this happen?" and trace the answer.

The player has no privileged status — but their Actor must always have a legible goal.

That goal is emergent, derived from their situation (a rivalry, a courtship, an inheritance).

It is never a scripted quest.

"World before player" and "do not lose the player" are reconciled here, not in tension.

A living world is overwhelming. Bound the player's attention so depth is felt, not drowned.

The simulation produces events. Presentation must narrate them into stories the player can follow and care about.

Prefer surfaced affordances over free-text parsing. Show the player what they can do.

---

# Engine Philosophy

The engine should know nothing about specific fictional universes.

There should never be code that references:

* Tolkien
* Star Trek
* Elder Scrolls
* Star Wars
* Warcraft

Those are Universe Packs.

The engine remains unchanged.

---

# Everything Is Data

Avoid hardcoded assumptions.

Examples:

Never write:

if race == "Elf"

Instead:

Species {
lifespan
physiology
intelligence
traits
reproduction
}

Likewise:

Kingdoms

Empires

Federations

Hive Worlds

All become generic Political Entities.

---

# Core Concepts

The engine should revolve around generic entities.

Examples:

* Actor
* Species
* Culture
* Settlement
* Political Entity
* Government
* Religion
* Profession
* Resource
* Economy
* Relationship
* Item
* Organization
* Event
* Technology
* Magic System
* Vehicle
* Region
* World

Every Universe Pack maps onto these concepts.

---

# Modular Simulation

The engine should support optional systems.

Possible modules include:

* Magic
* Space Travel
* Naval Travel
* Religion
* Crafting
* Cybernetics
* Genetics
* Psionics
* Mythic Creatures

Universe Packs choose which modules are enabled.

---

# Universe Packs

Universe Packs contain data.

Examples:

Fantasy

Sci-Fi

Historical

Modern

Steampunk

Post-Apocalyptic

Original Settings

Universe Packs should define:

* Species
* Cultures
* Governments
* Religions
* Technologies
* Locations
* Resources
* Professions
* Items
* Creatures

The simulation engine should require minimal changes when adding a new universe.

---

# AI Philosophy

AI is optional.

The simulation must never require internet connectivity.

AI may assist with:

* Universe creation
* Content generation
* Dialogue
* Flavor text
* Onboarding and narration
* Modding tools

AI belongs to the presentation layer — narration, flavor, teaching the player.

It must never touch the deterministic core.

The simulation itself should always be deterministic.

---

# Browser First

Primary platform:

Modern web browser.

Technology goals:

Frontend

* React
* TypeScript

Simulation

* TypeScript

Persistence

* IndexedDB

Future

* PostgreSQL
* Multiplayer
* Cloud Saves

Do not design around desktop-specific assumptions.

---

# Architecture Principles

Prefer:

Composition over inheritance.

Data over hardcoding.

Systems over scripts.

Deterministic simulation over randomness.

Reusable modules over special cases.

Small focused services over large monoliths.

Pure functions where practical.

Keep simulation separate from presentation.

---

# Coding Standards

Code should be:

* Readable
* Predictable
* Testable
* Deterministic
* Well documented

Avoid premature optimization.

Favor clarity over cleverness.

Every public API should have documentation.

---

# Performance Philosophy

Do not simulate everything continuously.

Use appropriate simulation frequencies.

Example:

Immediate

* Player actions

Hourly

* Local NPC activities

Daily

* Economy

Weekly

* Trade

Monthly

* Politics

Yearly

* Demographics
* History

Simulation detail should depend on relevance.

---

# Save Philosophy

The save file is the world.

Everything necessary to reconstruct the simulation should exist within it.

Avoid hidden runtime state.

Version save files carefully.

Backward compatibility is important.

---

# Long-Term Vision

MythOS should become a fictional universe simulation platform.

Potential future capabilities include:

* Community-created Universe Packs
* Modding SDK
* Multiplayer worlds
* Persistent online worlds
* Local AI narration
* Timeline replay
* Historical analysis tools
* Procedural civilizations
* Custom rule systems

---

# Inspiration

Learn from great simulation games.

Examples include:

* Warsim
* Dwarf Fortress
* RimWorld
* Crusader Kings
* Kenshi

Study what makes these games produce emergent stories.

Do not copy their implementations.

Understand their design principles.

---

# What Success Looks Like

Success is not measured by graphics.

But legible visualization of the simulation — maps, relationships, timelines — is essential.

Graphics are not the goal. Comprehension is.

Success is when players say:

"I've never seen this happen before."

The goal is to create a world where every playthrough generates unique histories and meaningful stories through simulation rather than scripts.

---

# Decision Filter

Before implementing any feature, ask:

1. Does this improve the simulation?
2. Is this generic enough to work across multiple universes?
3. Can this be data-driven?
4. Does it create new emergent gameplay?
5. Can the player understand the result, and trace why it happened?
6. Does it introduce unnecessary special cases?
7. Will this architecture still make sense five years from now?

If the answer to these questions is "no", reconsider the implementation.
