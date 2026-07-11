/**
 * The Spatial Foundation: a generic Location forms an acyclic containment tree, and a
 * deterministic traversal API answers "what contains what". These tests prove the engine
 * can REPRESENT arbitrary nested space (Planet › … › Room), with a settlement as just one
 * node in the tree (Settlement ⊂ Location), and that the tree survives a save/load — the
 * "first make things exist" milestone, before anything moves.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import {
  createLocation,
  setParent,
  removeLocation,
  getLocation,
  getParent,
  getChildren,
  getAncestors,
  getDescendants,
  getRoot,
  isAncestor,
  isDescendant,
  commonAncestor,
} from './location';
import type { World } from './model';

/** Build a canonical deep tree on a fresh world and hand back the named ids.
 *  Planet › Continent › Kingdom › City › District › Tavern › Room.
 *  The Kingdom also contains a real (worldgen) Settlement, proving Settlement ⊂ Location. */
function buildTree(w: World) {
  const planet = createLocation(w, { name: 'Aurea', locationType: 'planet' });
  const continent = createLocation(w, { name: 'Westmark', locationType: 'continent', parentId: planet });
  const kingdom = createLocation(w, { name: 'Highreach', locationType: 'kingdom', parentId: continent });
  const city = createLocation(w, { name: 'Stonehollow', locationType: 'city', parentId: kingdom });
  const district = createLocation(w, { name: 'Oldgate', locationType: 'district', parentId: city });
  const tavern = createLocation(w, { name: 'The Brass Tankard', locationType: 'building', parentId: district });
  const room = createLocation(w, { name: 'Back Room', locationType: 'room', parentId: tavern });
  // a worldgen settlement re-parented under the kingdom — a Location like any other
  const settlement = w.settlements[0].id;
  setParent(w, settlement, kingdom);
  return { planet, continent, kingdom, city, district, tavern, room, settlement };
}

const roundTrip = (w: World): World => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));

describe('Location: creation & registry', () => {
  it('allocates generic ids above the dense settlement range (no collision)', () => {
    const w = createWorld(1);
    const before = w.nextLocationId;
    // the allocator sits past the dense settlement range — venues minted at promote
    // (design/25) may already have advanced it beyond settlements.length
    expect(before).toBeGreaterThanOrEqual(w.settlements.length);
    const id = createLocation(w, { name: 'Aurea', locationType: 'planet' });
    expect(id).toBe(before);
    expect(getLocation(w, id)?.name).toBe('Aurea');
    expect(w.nextLocationId).toBe(before + 1);
    // a settlement id resolves through the same registry (Settlement ⊂ Location)
    expect(getLocation(w, w.settlements[0].id)).toBe(w.settlements[0]);
  });

  it('defaults a new location to fixed mobility and no parent (a root)', () => {
    const w = createWorld(2);
    const id = createLocation(w, { name: 'Drift', locationType: 'asteroid' });
    const loc = getLocation(w, id)!;
    expect(loc.mobility).toBe('fixed');
    expect(loc.parentId).toBeUndefined();
    expect(getRoot(w, id)?.id).toBe(id);
  });

  it('records mobility declaratively (a mobile location can exist; nothing moves)', () => {
    const w = createWorld(3);
    const ship = createLocation(w, { name: 'Wanderer', locationType: 'starship', mobility: 'mobile' });
    const pos0 = getLocation(w, ship)!.pos;
    expect(getLocation(w, ship)!.mobility).toBe('mobile');
    // declarative only: no movement system touches position in this phase
    expect(getLocation(w, ship)!.pos).toBe(pos0);
  });

  it('rejects creating a location under a non-existent parent', () => {
    const w = createWorld(4);
    expect(() => createLocation(w, { name: 'Orphan', locationType: 'room', parentId: 99999 })).toThrow();
  });
});

describe('Location: traversal API', () => {
  it('reports parents, ancestors, and the root', () => {
    const w = createWorld(10);
    const t = buildTree(w);
    expect(getParent(w, t.room)?.id).toBe(t.tavern);
    expect(getAncestors(w, t.room).map((l) => l.id)).toEqual([
      t.tavern, t.district, t.city, t.kingdom, t.continent, t.planet,
    ]);
    expect(getRoot(w, t.room)?.id).toBe(t.planet);
  });

  it('lists children and descendants in deterministic ascending-id order', () => {
    const w = createWorld(11);
    const t = buildTree(w);
    // the kingdom contains the city (created earlier) and the settlement (re-parented later)
    const kids = getChildren(w, t.kingdom).map((l) => l.id);
    expect(kids).toEqual([...kids].sort((a, b) => a - b));
    expect(kids).toContain(t.city);
    expect(kids).toContain(t.settlement);
    // descendants of the city are the linear chain below it, in order
    expect(getDescendants(w, t.city).map((l) => l.id)).toEqual([t.district, t.tavern, t.room]);
  });

  it('answers ancestor/descendant queries strictly', () => {
    const w = createWorld(12);
    const t = buildTree(w);
    expect(isAncestor(w, t.planet, t.room)).toBe(true);
    expect(isDescendant(w, t.room, t.planet)).toBe(true);
    expect(isAncestor(w, t.room, t.planet)).toBe(false);
    expect(isAncestor(w, t.room, t.room)).toBe(false); // strict: not its own ancestor
  });

  it('finds the nearest common ancestor', () => {
    const w = createWorld(13);
    const t = buildTree(w);
    // the room (under the city) and the settlement (under the kingdom) meet at the kingdom
    expect(commonAncestor(w, t.room, t.settlement)?.id).toBe(t.kingdom);
    // when one contains the other, that container is the common ancestor
    expect(commonAncestor(w, t.city, t.room)?.id).toBe(t.city);
    // two locations in different trees share nothing
    const lone = createLocation(w, { name: 'Elsewhere', locationType: 'planet' });
    expect(commonAncestor(w, t.room, lone)).toBeUndefined();
  });
});

describe('Location: tree mutation & invariants', () => {
  it('moving a node moves its whole subtree', () => {
    const w = createWorld(20);
    const t = buildTree(w);
    // re-home the city (and everything under it) directly under the continent
    setParent(w, t.city, t.continent);
    expect(getParent(w, t.city)?.id).toBe(t.continent);
    expect(getRoot(w, t.room)?.id).toBe(t.planet); // still in the same tree
    expect(getAncestors(w, t.room).map((l) => l.id)).toEqual([
      t.tavern, t.district, t.city, t.continent, t.planet,
    ]);
  });

  it('rejects a move that would create a cycle', () => {
    const w = createWorld(21);
    const t = buildTree(w);
    expect(() => setParent(w, t.planet, t.room)).toThrow(/cycle/i); // planet under its own descendant
    expect(() => setParent(w, t.city, t.city)).toThrow(); // a node cannot parent itself
    // the tree is unchanged after the rejected moves
    expect(getParent(w, t.planet)).toBeUndefined();
    expect(getRoot(w, t.room)?.id).toBe(t.planet);
  });

  it('removeLocation reparents children to the grandparent by default', () => {
    const w = createWorld(22);
    const t = buildTree(w);
    removeLocation(w, t.tavern); // the Room should adopt the District
    expect(getLocation(w, t.tavern)).toBeUndefined();
    expect(getParent(w, t.room)?.id).toBe(t.district);
    expect(getDescendants(w, t.district).map((l) => l.id)).toEqual([t.room]);
  });

  it('removeLocation cascade removes the whole subtree', () => {
    const w = createWorld(23);
    const t = buildTree(w);
    const removed = removeLocation(w, t.city, 'cascade').sort((a, b) => a - b);
    expect(removed).toEqual([t.city, t.district, t.tavern, t.room].sort((a, b) => a - b));
    for (const id of removed) expect(getLocation(w, id)).toBeUndefined();
    // the kingdom keeps the settlement; the city subtree is gone
    expect(getChildren(w, t.kingdom).map((l) => l.id)).toEqual([t.settlement]);
  });
});

describe('Location: persistence', () => {
  it('round-trips the containment tree identically through save/load', () => {
    const w = createWorld(30);
    const t = buildTree(w);
    const loaded = roundTrip(w);

    expect(loaded.nextLocationId).toBe(w.nextLocationId);
    expect(loaded.locations.size).toBe(w.locations.size);
    // every edge of the tree survives
    for (const id of w.locations.keys()) {
      expect(loaded.locations.get(id)?.parentId).toBe(w.locations.get(id)?.parentId);
      expect(loaded.locations.get(id)?.locationType).toBe(w.locations.get(id)?.locationType);
    }
    // and the derived API agrees on both
    expect(getAncestors(loaded, t.room).map((l) => l.id)).toEqual(getAncestors(w, t.room).map((l) => l.id));
    expect(getChildren(loaded, t.kingdom).map((l) => l.id)).toEqual(getChildren(w, t.kingdom).map((l) => l.id));
    // settlements re-enter the registry by reference (same object as world.settlements)
    expect(loaded.locations.get(loaded.settlements[0].id)).toBe(loaded.settlements[0]);
  });

  it('a default world reloads with every settlement a fixed root (venues intact under it)', () => {
    const w = createWorld(31);
    const loaded = roundTrip(w);
    // the registry holds the settlements PLUS the focused town's venues (design/25)
    expect(loaded.locations.size).toBe(w.locations.size);
    expect(loaded.locations.size).toBeGreaterThanOrEqual(loaded.settlements.length);
    for (const s of loaded.settlements) {
      expect(s.locationType).toBe('settlement');
      expect(s.mobility).toBe('fixed');
      expect(s.parentId).toBeUndefined();
      expect(getRoot(loaded, s.id)?.id).toBe(s.id);
    }
  });

  it('migrates a pre-v9 save by backfilling the Location base fields', () => {
    const w = createWorld(32);
    const save = JSON.parse(JSON.stringify(serializeWorld(w)));
    // simulate an old save: no spatial-foundation data, settlements lack the new fields
    save.version = 8;
    delete save.locations;
    delete save.nextLocationId;
    for (const st of save.settlements) {
      delete st.locationType;
      delete st.mobility;
      delete st.parentId;
    }
    const loaded = deserializeWorld(save);
    expect(loaded.nextLocationId).toBe(loaded.settlements.length);
    expect(loaded.locations.size).toBe(loaded.settlements.length);
    for (const s of loaded.settlements) {
      expect(s.locationType).toBe('settlement');
      expect(s.mobility).toBe('fixed');
    }
  });
});
