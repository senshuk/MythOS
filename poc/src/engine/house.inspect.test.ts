/**
 * A HOUSE is now a first-class, inspectable thing: inspectHouse assembles the dynasty's
 * founder, its line of members, and its saga; and "House X" in event prose links to it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorld, runYears, inspectHouse, inspectCulture, inspectDeity } from './sim';
import { renderEventParts } from './render';
import { getEvent } from './world';
import { foundHouse } from './figures';
import type { World, HistoricalFigure } from './model';

let w: World;
beforeAll(() => {
  w = createWorld(7, true);
  runYears(w, 45);
});

describe('inspectHouse — the dynasty made inspectable', () => {
  it('assembles a House from its founder, line, and saga', () => {
    expect(w.houses.length).toBeGreaterThan(0);
    const house = w.houses[0];
    const d = inspectHouse(w, house.id)!;
    expect(d).toBeDefined();
    expect(d.name).toBe(house.name);
    expect(d.founder?.id).toBe(house.founderId); // the founder resolves to a figure
    expect(d.members.length).toBeGreaterThan(0); // at least the founder is in the line
    expect(d.members.every((m) => w.figuresById.has(m.id))).toBe(true); // every member inspectable
    expect(inspectHouse(w, house.id)).toEqual(d); // deterministic
    expect(inspectHouse(w, 9_999_999)).toBeUndefined(); // unknown → nothing
  });

  it('renders the line as a well-formed genealogy', () => {
    let sawKinship = false;
    for (const house of w.houses) {
      const d = inspectHouse(w, house.id)!;
      const ids = new Set(d.members.map((m) => m.id));
      // the founder flag is set on exactly the founder record, and nobody else
      expect(d.members.every((m) => m.isFounder === (m.id === house.founderId))).toBe(true);
      // at most one living head, and only while the House holds a seat; a head is alive
      const heads = d.members.filter((m) => m.isSeat);
      expect(heads.length).toBeLessThanOrEqual(1);
      if (house.seatSettlementId === undefined) expect(heads.length).toBe(0);
      for (const h of heads) expect(h.deathYear).toBeUndefined();
      for (const m of d.members) {
        expect(Number.isFinite(m.bornYear)).toBe(true); // every member carries dates now
        // kinship edges stay within the rendered set and are symmetric
        for (const p of m.parentIds) {
          expect(ids.has(p)).toBe(true);
          expect(d.members.find((x) => x.id === p)!.childIds).toContain(m.id);
        }
        for (const c of m.childIds) {
          expect(ids.has(c)).toBe(true);
          expect(d.members.find((x) => x.id === c)!.parentIds).toContain(m.id);
          sawKinship = true;
        }
        // spouses resolve to real figures
        for (const s of m.spouses) expect(w.figuresById.has(s.id)).toBe(true);
      }
    }
    // not asserted as a hard requirement (kinship needs simulated actors), just noted
    void sawKinship;
  });

  it('surfaces a three-generation kinship tree, the head, and a married-in spouse', () => {
    // Kinship among House members forms only for SIMULATED actors (they carry SocialTies) —
    // minted rulers have none, so most Houses render as a plain succession line. Here we
    // construct the kin-linked case a focused dynasty produces after ≥2 crowned generations,
    // and assert inspectHouse surfaces it as a genealogy (parent/child edges, head, spouse).
    const world = createWorld(11, true);
    const s = world.settlements[0];
    const mk = (given: string, surname: string, born: number, reignStart: number, deathYear?: number): HistoricalFigure => {
      const f: HistoricalFigure = {
        id: world.nextEntityId++, name: `${given} ${surname}`, species: 'human', role: 'ruler',
        settlementId: s.id, bornYear: born, reignStart, reignEnd: reignStart + 40, deathYear,
      };
      world.figures.push(f);
      world.figuresById.set(f.id, f);
      return f;
    };
    const gran = mk('Aa', 'Testhold', 0, 20, 55); // founder, since dead
    const house = foundHouse(world, gran, s.id, 20); // sets gran.houseId + seatSettlementId
    const parent = mk('Bb', 'Testhold', 30, 55, 90); // gran's child, ruled next, since dead
    parent.houseId = house.id;
    const child = mk('Cc', 'Testhold', 60, 90); // parent's child, current living head
    child.houseId = house.id;
    const inLaw = mk('Dd', 'Otherhold', 62, 95); // child's spouse — married in from another House
    foundHouse(world, inLaw, s.id, 95); // gives the spouse a distinct House to link to
    world.ties.set(gran.id, { spouses: [], parents: [], children: [parent.id] });
    world.ties.set(parent.id, { spouses: [], parents: [gran.id], children: [child.id] });
    world.ties.set(child.id, { spouses: [inLaw.id], parents: [parent.id], children: [] });

    const d = inspectHouse(world, house.id)!;
    const by = Object.fromEntries(d.members.map((m) => [m.name.split(' ')[0], m]));
    expect(d.members.length).toBe(3); // the in-law is of another House, not a member
    expect(by.Aa.isFounder).toBe(true);
    expect([by.Bb.isFounder, by.Cc.isFounder]).toEqual([false, false]);
    // the descent chain Aa → Bb → Cc, as symmetric edges
    expect(by.Aa.childIds).toContain(by.Bb.id);
    expect(by.Bb.parentIds).toContain(by.Aa.id);
    expect(by.Bb.childIds).toContain(by.Cc.id);
    expect(by.Cc.parentIds).toContain(by.Bb.id);
    // exactly one root (the founder), so the tree renders from a single stem
    expect(d.members.filter((m) => m.parentIds.length === 0).map((m) => m.id)).toEqual([by.Aa.id]);
    // the living head holds the seat; the dead founder does not
    expect(by.Cc.isSeat).toBe(true);
    expect(by.Aa.isSeat).toBe(false);
    // the married-in spouse resolves to a figure of the OTHER House
    expect(by.Cc.spouses.map((sp) => sp.name)).toEqual(['Dd Otherhold']);
    expect(by.Cc.spouses[0].houseName).toBe('Otherhold');
  });

  it('links "House X" in event prose to the dynasty', () => {
    // find any event whose prose names a House, and confirm that run carries a house ref
    let linked = false;
    for (const ev of [...w.events].reverse()) {
      const houseName = (ev.data.house ?? ev.data.old) as string | undefined;
      if (!houseName) continue;
      const parts = renderEventParts(w, ev);
      if (parts.some((p) => p.ref?.kind === 'house')) { linked = true; break; }
    }
    // if a House-naming event exists this run, its prose must link the House
    const anyHouseEvent = [...w.events].some((e) => e.data.house !== undefined || e.data.old !== undefined);
    if (anyHouseEvent) expect(linked).toBe(true);
    // and the ref a prose link carries actually resolves
    for (const ev of w.events) {
      for (const p of renderEventParts(w, ev)) {
        if (p.ref?.kind === 'house') expect(inspectHouse(w, p.ref.id)).toBeDefined();
      }
    }
    void getEvent; // (kept: archive-aware fetch, if a future assertion needs it)
  });
});

describe('inspectCulture / inspectDeity — creeds and gods made inspectable', () => {
  it('a culture reports its towns, creed, and patron god', () => {
    const d = inspectCulture(w, 'martial')!;
    expect(d).toBeDefined();
    expect(d.name).toContain('Iron'); // the Iron Creed
    expect(d.patronDeity?.id).toBeTruthy();
    // every town it lists actually holds this creed
    for (const t of d.settlements) expect(w.settlements[t.id]?.cultureId).toBe('martial');
    expect(inspectCulture(w, 'martial')).toEqual(d); // deterministic
    expect(inspectCulture(w, 'no-such-culture')).toBeUndefined();
  });

  it('a deity reports its domain and the creeds that venerate it', () => {
    const culture = inspectCulture(w, 'martial')!;
    const deityId = culture.patronDeity!.id;
    const d = inspectDeity(w, deityId)!;
    expect(d.domain.length).toBeGreaterThan(0);
    expect(d.cultures.some((c) => c.id === 'martial')).toBe(true); // martial venerates it
    expect(inspectDeity(w, deityId)).toEqual(d); // deterministic
    expect(inspectDeity(w, 'no-such-god')).toBeUndefined();
  });
});
