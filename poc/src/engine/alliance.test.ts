/**
 * THE ALLIANCE PACT (Phase 2E) — a mutual-defense agreement with real teeth. Two courts
 * bound in alliance never turn on one another (a cold alliance is a peace too), and beyond
 * that each is DRAWN INTO the other's wars: when an ally is raided or conquered, its allies
 * that share a border with the aggressor are pulled toward the quarrel, so a chain of pacts
 * can widen a raid into a coalition. Deterministic and RNG-free at the drawing-in step, so a
 * world with no alliances is byte-identical (guarded by the determinism suite).
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears } from './sim';
import { drawInAllies, geographyYearly } from './lod';
import { interactionById, interactionForIntent, applyProposalOutcome, activeAgreement, sealAgreement } from './orgInteraction';

/** A forged world with governed settlements and a developed region graph. */
function forged(seed = 123456) {
  const w = createWorld(seed);
  runYears(w, 6);
  return w;
}

/** The region edge between two settlement ids, if they are neighbours. */
function edgeBetween(w: ReturnType<typeof createWorld>, a: number, b: number) {
  return w.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

describe('the alliance interaction', () => {
  it('is what a polity preparing for war reaches for', () => {
    expect(interactionForIntent('prepare_war')?.id).toBe('alliance');
  });

  it('seals a standing alliance both courts record their own way', () => {
    const w = forged();
    // two distinct living polities
    const orgs = w.organizations.filter((o) => o.dissolvedYear === undefined && o.seatId !== undefined);
    const from = orgs[0];
    const to = orgs.find((o) => o.id !== from.id)!;
    const def = interactionById('alliance')!;
    const before = w.events.length;
    // force the accepted path — the outcome wiring is what this checks (accept-vs-refuse
    // by evaluate() is the pipeline's job, covered in orgInteraction.test)
    applyProposalOutcome(w, def, from, to, { years: 20 }, true);
    expect(activeAgreement(w, 'alliance', from.id, to.id)).toBeDefined();
    const sealed = w.events.slice(before).find((e) => e.type === 'pact_sealed');
    expect(sealed?.data.kind).toBe('alliance');
    expect(w.lastInteraction.get(from.id)?.summary).toContain('alliance');
    expect(w.lastInteraction.get(to.id)?.summary).toContain('alliance');
  });
});

describe('allies do not turn on one another', () => {
  it('no raid, battle, or conquest fires between two allied neighbours, however cold the border', () => {
    const w = forged();
    // a pair of adjacent governed settlements
    let a = -1, b = -1;
    for (const e of w.edges) {
      const A = w.settlements[e.a], B = w.settlements[e.b];
      if (A.polityId !== undefined && B.polityId !== undefined && A.ruinedYear === undefined && B.ruinedYear === undefined) {
        a = e.a; b = e.b; break;
      }
    }
    expect(a).toBeGreaterThanOrEqual(0);
    const Pa = w.settlements[a].polityId!, Pb = w.settlements[b].polityId!;
    sealAgreement(w, 'alliance', Pa, Pb, 40); // a long alliance
    edgeBetween(w, a, b)!.relation = -80; // and a bitterly cold border despite it
    const nameA = w.settlements[a].name, nameB = w.settlements[b].name;
    const before = w.events.length;
    for (let i = 0; i < 60; i++) geographyYearly(w);
    // over sixty years no blood is shed between the allies (the alliance stays their hands)
    const clash = w.events.slice(before).some(
      (e) => (e.type === 'raid' || e.type === 'battle' || e.type === 'conquest') &&
        [e.data.a, e.data.b, e.data.raider, e.data.victim, e.data.fallen, e.data.victor].includes(nameA) &&
        [e.data.a, e.data.b, e.data.raider, e.data.victim, e.data.fallen, e.data.victor].includes(nameB),
    );
    expect(clash).toBe(false);
  });
});

describe('mutual defense fields real force', () => {
  /** Set up a strong aggressor adjacent to a weak town it could raze, plus a third governed
   *  polity to serve as the weak town's ally. Returns the pieces and the forced-war driver. */
  function siege(w: ReturnType<typeof createWorld>) {
    // two adjacent, non-focused, governed neighbours
    let strongId = -1, weakId = -1;
    for (const e of w.edges) {
      const A = w.settlements[e.a], B = w.settlements[e.b];
      if (A.polityId !== undefined && B.polityId !== undefined && !A.detailed && !B.detailed &&
          A.ruinedYear === undefined && B.ruinedYear === undefined) { strongId = e.a; weakId = e.b; break; }
    }
    expect(strongId).toBeGreaterThanOrEqual(0);
    const setPop = (id: number, pop: number) => {
      const m = w.settlements[id].macro;
      m.population = pop; m.adults = Math.round(pop * 0.7); m.children = Math.round(pop * 0.2); m.elders = pop - m.adults - m.children;
    };
    setPop(strongId, 400); // strong.pop (400) > weak.pop (200) * 1.28 = 256 → would raze, absent allies
    setPop(weakId, 200);
    const ally = w.settlements.find((s) => s.polityId !== undefined && !s.detailed && s.ruinedYear === undefined &&
      s.id !== strongId && s.id !== weakId)!;
    setPop(ally.id, 1000); // an ally strong enough that (200 + 1000*0.5) * 1.28 = 896 > 400 → the raze is repelled
    const edge = edgeBetween(w, strongId, weakId)!;
    const drive = () => { edge.relation = -100; geographyYearly(w); }; // force the border to the brink each year
    return { strongId, weakId, ally, drive, weakName: w.settlements[weakId].name };
  }

  it('a strong ally turns a would-be conquest into a battle the town survives', () => {
    const w = forged();
    w.orgAgreements = [];
    const { weakId, ally, drive, weakName } = siege(w);
    sealAgreement(w, 'alliance', w.settlements[weakId].polityId!, ally.polityId!, 60);
    const before = w.events.length;
    for (let i = 0; i < 150 && w.settlements[weakId].macro.population > 25; i++) drive();
    const since = w.events.slice(before);
    // the town was never razed, and its ally is recorded answering the call
    expect(since.some((e) => e.type === 'conquest' && e.data.fallen === weakName)).toBe(false);
    expect(since.some((e) => e.type === 'alliance_answered' && e.data.defended === weakName)).toBe(true);
  });

  it('without that ally, the same weak town is conquered', () => {
    const w = forged();
    w.orgAgreements = []; // no alliance to shield it
    const { weakId, drive, weakName } = siege(w);
    const before = w.events.length;
    for (let i = 0; i < 200 && w.settlements[weakId].ruinedYear === undefined && w.settlements[weakId].macro.population > 0; i++) drive();
    // left to face the aggressor alone, the town falls (a conquest names it fallen)
    expect(w.events.slice(before).some((e) => e.type === 'conquest' && e.data.fallen === weakName)).toBe(true);
  });
});

describe('an ally is drawn into a neighbour\'s war', () => {
  it('souring the ally\'s border with the aggressor — but only where they share one', () => {
    const w = forged();
    // an aggressor with two distinct governed neighbours: the victim, and the victim's ally
    let agg = -1, victim = -1, ally = -1;
    for (const s of w.settlements) {
      if (s.polityId === undefined || s.ruinedYear !== undefined) continue;
      const nb = w.edges
        .map((e) => (e.a === s.id ? e.b : e.b === s.id ? e.a : -1))
        .filter((n) => n >= 0 && w.settlements[n]?.polityId !== undefined && w.settlements[n]?.ruinedYear === undefined);
      if (nb.length >= 2) { agg = s.id; victim = nb[0]; ally = nb[1]; break; }
    }
    expect(agg).toBeGreaterThanOrEqual(0);
    w.orgAgreements = []; // isolate from any alliances the forge itself negotiated
    const Pv = w.settlements[victim].polityId!, Pal = w.settlements[ally].polityId!;
    sealAgreement(w, 'alliance', Pv, Pal, 20); // the ally is bound to the victim
    const allyEdge = edgeBetween(w, ally, agg)!;
    allyEdge.relation = 0; // start neutral so the souring is unambiguous
    const before = allyEdge.relation;

    drawInAllies(w, w.settlements[victim], w.settlements[agg]);

    expect(allyEdge.relation).toBeLessThan(before); // the ally is drawn against the aggressor
  });

  it('leaves an ally with no shared border untouched (sympathy has no front)', () => {
    const w = forged();
    // victim and aggressor adjacent; an ally of the victim that is NOT adjacent to the aggressor
    let agg = -1, victim = -1;
    for (const e of w.edges) {
      const A = w.settlements[e.a], B = w.settlements[e.b];
      if (A.polityId !== undefined && B.polityId !== undefined) { agg = e.a; victim = e.b; break; }
    }
    const aggNeighbours = new Set(
      w.edges.map((e) => (e.a === agg ? e.b : e.b === agg ? e.a : -1)).filter((n) => n >= 0),
    );
    const distant = w.settlements.find(
      (s) => s.polityId !== undefined && s.ruinedYear === undefined && s.id !== agg && s.id !== victim && !aggNeighbours.has(s.id),
    );
    if (!distant) return; // fully-connected tiny graph — nothing to assert
    w.orgAgreements = []; // isolate from forge-negotiated alliances
    sealAgreement(w, 'alliance', w.settlements[victim].polityId!, distant.polityId!, 20);
    const snapshot = w.edges.map((e) => e.relation);
    drawInAllies(w, w.settlements[victim], w.settlements[agg]);
    // no edge changed: the distant ally shares no border with the aggressor
    expect(w.edges.map((e) => e.relation)).toEqual(snapshot);
  });
});
