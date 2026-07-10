/**
 * Death as a TRANSITION — the Dynasty step of the gameplay loop (CLAUDE.md: "Death is a
 * transition, not a game over — inherit an heir, or follow another life"). These pin:
 * the heir rule's priority (eldest child → surviving spouse → eldest sibling), that the
 * handoff passes control and cites the death (traceable history), that a new life starts
 * with fresh ambitions, that the line is FOLLOWED to another settlement through the
 * normal focus machinery, and that the dead player's view surfaces the offer.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, possess, buildSnapshot, inheritHeir } from './sim';
import { heirOf } from './player';
import { fullActors, createActor, killActor } from './world';
import { type World, type EntityId } from './model';

/** A small world plus a hand-built family around `elder`, so kinship is exact. */
function familyWorld(seed: number) {
  const w = createWorld(seed);
  runYears(w, 2);
  const template = w.identity.get(fullActors(w)[0])!; // a valid species/sex for this pack
  const mk = (given: string, ageYears: number, parents?: EntityId[]) =>
    createActor(w, {
      given,
      family: 'Testline',
      sex: template.sex,
      speciesId: template.speciesId,
      profession: 'farmer',
      traits: [],
      ageYears,
      parents,
    });
  return { w, mk };
}

const die = (w: World, id: EntityId) => killActor(w, id, w.tick, 'died', [], []);

describe('heirOf — the family rule (blood, then household, then the wider line)', () => {
  it('the eldest living child inherits first; the next in age follows', () => {
    const { w, mk } = familyWorld(11);
    const elder = mk('Elder', 52);
    const younger = mk('Younger', 19, [elder]);
    const eldest = mk('Eldest', 26, [elder]);
    w.ties.get(elder)!.children.push(younger, eldest);

    die(w, elder);
    expect(heirOf(w, elder)).toEqual({ heirId: eldest, relation: 'child' });

    die(w, eldest); // the first heir falls; the line moves to the next child
    expect(heirOf(w, elder)).toEqual({ heirId: younger, relation: 'child' });
  });

  it('a surviving spouse inherits a childless line (recovered through the widowed event)', () => {
    const { w, mk } = familyWorld(12);
    const elder = mk('Elder', 48);
    const widow = mk('Widow', 45);
    w.ties.get(elder)!.spouses.push(widow);
    w.ties.get(widow)!.spouses.push(elder);

    die(w, elder); // killActor severs the spouse tie — the widow is found via history
    expect(heirOf(w, elder)).toEqual({ heirId: widow, relation: 'spouse' });
  });

  it('the eldest living sibling carries a line with no child or spouse', () => {
    const { w, mk } = familyWorld(13);
    const parent = mk('Parent', 70);
    const a = mk('A', 40, [parent]);
    const b = mk('B', 44, [parent]);
    w.ties.get(parent)!.children.push(a, b);

    die(w, a);
    expect(heirOf(w, a)).toEqual({ heirId: b, relation: 'sibling' });
  });

  it('with no living kin, the line ends (undefined)', () => {
    const { w, mk } = familyWorld(14);
    const loner = mk('Loner', 60);
    die(w, loner);
    expect(heirOf(w, loner)).toBeUndefined();
  });
});

describe('inheritHeir — the handoff', () => {
  it('passes control to the heir, cites the death, and starts a fresh life', () => {
    const { w, mk } = familyWorld(21);
    const elder = mk('Elder', 52);
    const heir = mk('Heir', 24, [elder]);
    w.ties.get(elder)!.children.push(heir);
    possess(w, elder);
    w.playerAmbition = { id: 'rival', chosenTick: w.tick }; // the dead's steering state

    const deathId = die(w, elder);
    inheritHeir(w);

    expect(w.playerId).toBe(heir);
    expect(w.playerAmbition).toBeUndefined(); // a new life carries no inherited ambition
    const ev = w.events.find((e) => e.type === 'inherited');
    expect(ev).toBeDefined();
    expect(ev!.subjects[0]).toBe(heir);
    expect(ev!.causes).toContain(deathId); // the chronicle can trace the line's turning
    expect(ev!.data.relation).toBe('child');
  });

  it('is a no-op while the player lives, and when no kin remains', () => {
    const { w, mk } = familyWorld(22);
    const elder = mk('Elder', 52);
    possess(w, elder);
    inheritHeir(w); // alive — nothing happens
    expect(w.playerId).toBe(elder);

    die(w, elder); // no kin — the line has ended; control stays for the player to release
    inheritHeir(w);
    expect(w.playerId).toBe(elder);
    expect(w.events.find((e) => e.type === 'inherited')).toBeUndefined();
  });

  it('follows the line to another settlement, promoting the heir to full fidelity', () => {
    const { w, mk } = familyWorld(23);
    const target = w.settlements.find((s) => s.id !== 0 && s.ruinedYear === undefined)!;
    expect(target).toBeDefined();

    const elder = mk('Elder', 52);
    const heir = mk('Heir', 30, [elder]);
    w.ties.get(elder)!.children.push(heir);
    // the heir lives elsewhere as a named (summary) soul
    w.fidelity.set(heir, 'summary');
    w.homeSettlement.set(heir, target.id);

    possess(w, elder);
    die(w, elder);
    inheritHeir(w);

    expect(w.playerId).toBe(heir);
    expect(w.focusedSettlementId).toBe(target.id); // attention followed the line
    expect(w.fidelity.get(heir)).toBe('full'); // promoted by the normal focus machinery
  });
});

describe('the dead player’s view — the offer is surfaced', () => {
  it('names the heir and their relation while an heir exists', () => {
    const { w, mk } = familyWorld(31);
    const elder = mk('Elder', 52);
    const heir = mk('Heir', 24, [elder]);
    w.ties.get(elder)!.children.push(heir);
    possess(w, elder);
    die(w, elder);

    const player = buildSnapshot(w).player!;
    expect(player.alive).toBe(false);
    expect(player.succession?.heirId).toBe(heir);
    expect(player.succession?.heirName).toContain('Heir');
    expect(player.succession?.relation).toBeTruthy(); // a pack phrase, not an enum leak
    expect(player.lineEnds).toBeUndefined();
  });

  it('states that the line has ended when no kin survives', () => {
    const { w, mk } = familyWorld(32);
    const loner = mk('Loner', 60);
    possess(w, loner);
    die(w, loner);

    const player = buildSnapshot(w).player!;
    expect(player.succession).toBeUndefined();
    expect(player.lineEnds).toBeTruthy();
  });
});
