/**
 * Not a pass/fail unit test — a DEMONSTRATION of the engine's behaviour:
 *   1. a varied, readable history emerges,
 *   2. any notable event traces back to its causes (legibility), and
 *   3. the world is far larger than what we simulate in detail (LOD), with
 *      off-screen settlements evolving while you're not looking.
 * Run with:  npx vitest run src/engine/narrative.demo.test.ts
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, buildSnapshot, inspectEvent, inspectActor, focusSettlement } from './sim';
import { fullActors } from './world';

describe('narrative demo', () => {
  it('generates a deep pre-play past headlessly, then a player enters it', () => {
    const line = (s: string) => console.log(s);
    // headless worldgen: centuries of aggregate history, no live actors, fast
    const world = createWorld(1492, false);
    const t0 = Date.now();
    runYears(world, 200);
    const ms = Date.now() - t0;

    let snap = buildSnapshot(world, 9999);
    line('');
    line(`==== A WORLD WITH A PAST · ${200} years simulated headlessly in ${ms}ms ====`);
    line(`world population ${snap.worldPopulation} across ${snap.settlements.length} settlements; 0 simulated in detail (no one has entered yet)`);
    line(`the storyteller (${snap.director.label}) shaped ${snap.director.incidents} incidents`);
    const c = (t: string) => world.events.filter((e) => e.type === t).length;
    line(
      `  event variety: wonder ${c('wonder')} · beast ${c('beast')} · omen ${c('omen')} · battle ${c('battle')} · ` +
        `conquest ${c('conquest')} || plague ${c('plague')} · famine ${c('famine')} · raid ${c('raid')}`,
    );
    const surviving = world.settlements.filter((s) => s.ruinedYear === undefined).length;
    line(`  WORLD HEALTH: ${surviving}/${world.settlements.length} settlements survive (pop ${snap.worldPopulation})`);

    line('\n-- the named ages of this world --');
    for (const e of snap.eras.slice(0, 10)) line(`  y${e.year}: ${e.title}`);
    line('\n-- legends already told before any player arrives --');
    for (const t of snap.chronicle.slice(0, 8)) line(`  (y${t.year}) ${t.text}`);

    line('\n-- renowned figures of this history --');
    for (const f of snap.historicalFigures.slice(0, 8)) {
      const reign = f.deathYear !== undefined ? `r.${f.reignStart}–${f.deathYear}` : `r.${f.reignStart}–`;
      line(`  ${f.name} (${f.role} of ${f.settlement}, ${reign})`);
    }

    // the player enters: promote the greatest surviving settlement to full fidelity
    let target = 0;
    for (const s of world.settlements) if (s.macro.population > world.settlements[target].macro.population) target = s.id;
    focusSettlement(world, target);
    runYears(world, 5);
    snap = buildSnapshot(world, 9999);
    line(`\n-- a player enters ${snap.settlementName} (year ${snap.year}), now simulated in detail (${snap.simulatedInDetail} souls) --`);
    line('  …stepping into a world that already has ' + snap.chronicle.length + ' remembered tales and ' + snap.eras.length + ' named years.');
    line('');

    expect(world.events.length).toBeGreaterThan(50);
    expect(snap.eras.length).toBeGreaterThan(0);
  });

  it('prints an emergent story, a traced cause, and the LOD/world-scale picture', () => {
    const line = (s: string) => console.log(s);
    const world = createWorld(42);
    runYears(world, 60);

    let snap = buildSnapshot(world, 9999);
    line('');
    line(`==== THE WORLD · year ${snap.year} ====`);
    line(
      `world population ${snap.worldPopulation} across ${snap.settlements.length} settlements; ` +
        `only ${snap.simulatedInDetail} simulated in detail (in ${snap.settlementName}), ` +
        `plus ${snap.namedPeople} named people tracked elsewhere (summary tier)`,
    );
    {
      let friend = 0, spouse = 0, rival = 0, feud = 0, acq = 0;
      const seen = new Set<string>();
      for (const [a, m] of world.rels) for (const [b, e] of m) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (e.flags.spouse) spouse++;
        else if (e.flags.feud) feud++;
        else if (e.flags.friend) friend++;
        else if (e.flags.rival) rival++;
        else acq++;
      }
      const inc = world.events.filter((e) => e.type === 'boon' || e.type === 'blight' || e.type === 'plague').length;
      line(`  storyteller: ${snap.director.label} · ${snap.director.incidents} incidents (${inc} events) · tension ${snap.director.tension} · ${snap.director.mood}`);
      line(`  focused vitals: births ${snap.totalBorn} deaths ${snap.totalDied} marriages ${snap.marriages} feuds ${snap.feuds}`);
      line(`  relationships: ${spouse} spouse · ${friend} friend · ${rival} rival · ${feud} feud · ${acq} acquaintance`);
    }
    line('\n-- settlements (◉ = focused/full-fidelity, ○ = aggregate) --');
    for (const s of snap.settlements) {
      line(
        `  ${s.detailed ? '◉' : '○'} ${s.name.padEnd(12)} pop ${String(s.population).padStart(4)} ` +
          `· ${s.dominantSpecies.padEnd(6)} · stability ${s.stability}` +
          (s.figureNames.length ? ` · remembered: ${s.figureNames.join(', ')}` : ''),
      );
    }

    line(`\n-- recent history in ${snap.settlementName} --`);
    for (const ev of snap.recentEvents.slice(0, 12).reverse()) line(`  y${ev.year}: ${ev.text}`);

    // trace causality of an interesting event
    const interesting =
      world.events.find((e) => e.type === 'died_brawl') ??
      world.events.find((e) => e.type === 'feud');
    if (interesting) {
      const chain = inspectEvent(world, interesting.id)!;
      line('\n-- tracing causality --');
      line(`  EVENT  y${chain.root.year}: ${chain.root.text}`);
      for (const a of chain.ancestors) line(`    <- y${a.year}: ${a.text}`);
    }

    // migration: named people moving between settlements
    const migrations = snap.recentEvents
      .filter((e) => e.type === 'emigrated' || e.type === 'immigrated')
      .slice(0, 4);
    if (migrations.length) {
      line('\n-- migration (named people moving between settlements) --');
      for (const ev of migrations) line(`  y${ev.year}: ${ev.text}`);
    }

    // a relationship that now spans two settlements
    for (const id of fullActors(world)) {
      const d = inspectActor(world, id)!;
      const away = d.relationships.find((r) => r.away);
      if (away) {
        line('\n-- a relationship that spans settlements --');
        line(
          `  ${d.actor.name} (in ${snap.settlementName}) still shares a ${away.kind} bond with ` +
            `${away.otherName}, who now lives in ${away.otherSettlement}`,
        );
        break;
      }
    }

    // region geography: trade routes & frontiers
    const friendly = world.edges.filter((e) => e.relation > 15).length;
    const hostile = world.edges.filter((e) => e.relation < -20).length;
    line('\n-- region geography (trade routes & frontiers) --');
    line(
      `  ${world.edges.length} routes link the settlements: ${friendly} active trade routes, ` +
        `${hostile} hostile borders`,
    );
    const geo = snap.recentEvents.filter((e) => e.type === 'trade' || e.type === 'raid' || e.type === 'famine').slice(0, 5);
    for (const ev of geo) line(`  y${ev.year}: ${ev.text}`);

    // economy: specializations, prices, wealth
    line('\n-- economy (specialization · wealth · food price) --');
    for (const s of snap.settlements) {
      line(
        `  ${s.name.padEnd(12)} ${s.specialization.padEnd(8)} · ${String(s.wealth).padStart(5)}w ` +
          `· food ${s.prices.food.toFixed(2)} (${(s.subsistenceSecurity).toFixed(1)}yr)`,
      );
    }
    line(`  total world wealth: ${snap.worldWealth}`);

    // the chronicle: named years + legends (history re-narrated as content)
    line('\n-- the chronicle: named years --');
    for (const e of snap.eras.slice(0, 8)) line(`  y${e.year}: ${e.title}`);
    line('\n-- legends the world still tells --');
    for (const t of snap.chronicle.slice(0, 8)) line(`  (y${t.year}, interest ${t.interest}) ${t.text}`);

    // demonstrate LOD: focus a settlement we've never simulated, watch it come alive
    const target = snap.settlements.find((s) => !s.detailed)!;
    line(`\n-- focusing ${target.name} (was aggregate pop ${target.population}) --`);
    focusSettlement(world, target.id);
    runYears(world, 15);
    snap = buildSnapshot(world, 9999);
    const nowFocused = snap.settlements.find((s) => s.id === target.id)!;
    line(`  ${target.name} is now simulated in detail: ${nowFocused.population} actors, ` +
      `${snap.recentEvents.filter((e) => e.year > snap.year - 15).length} recent events`);
    line(`  meanwhile world population is ${snap.worldPopulation}, still only ` +
      `${snap.simulatedInDetail} simulated in detail`);
    line('');

    expect(world.events.length).toBeGreaterThan(100);
    expect(snap.worldPopulation).toBeGreaterThan(snap.simulatedInDetail);
  });
});



































