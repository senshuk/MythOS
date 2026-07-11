/**
 * The simulation host. Runs entirely inside a Web Worker: it owns the World and
 * is the ONLY place the sim mutates. The main thread never touches sim state —
 * it asks via messages and renders the snapshots it gets back.
 */
import { type World, DAYS_PER_YEAR } from '../engine/model';
import {
  createWorld,
  forgeWorld,
  runYears,
  buildSnapshot,
  inspectActor,
  inspectEvent,
  inspectFigure,
  inspectSettlement,
  inspectHouse,
  inspectCulture,
  inspectDeity,
  inspectFeature,
  inspectVenue,
  localVenues,
  buildPeek,
  buildLocalChronicle,
  buildHouseholds,
  ensureFocusedVenues,
  isPlayerAlive,
  pendingDecisionIds,
  focusSettlement,
  setStoryteller,
  possess,
  release,
  inheritHeir,
  playerTurn,
  checkPlayerGoal,
  reviewPlayerAmbition,
  chooseAmbition,
  abandonAmbition,
} from '../engine/sim';
import { serializeWorld, deserializeWorld } from '../engine/persistence';
import { putSave, getSave, listSaves } from '../engine/idb';
import type { SimRequest, SimResponse } from './protocol';

// `self` typed loosely to avoid pulling in the conflicting WebWorker lib.
const ctx = self as unknown as {
  postMessage: (m: SimResponse) => void;
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
};

let world: World | null = null;

function reset(seed: number): void {
  world = createWorld(seed);
}

/** The one streaming advance in flight (time flow). `cancelled` is set by stopAdvance;
 *  the loop yields to the event queue between years, so the stop can land mid-batch. */
let advancing: { cancelled: boolean } | null = null;

ctx.onmessage = async (e: MessageEvent<SimRequest>) => {
  const msg = e.data;
  switch (msg.kind) {
    case 'init':
    case 'reset': {
      reset(msg.seed);
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'genesis': {
      // forge a world with deep pre-history, then enter it
      world = forgeWorld(msg.seed, msg.years, msg.storyteller);
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world) });
      break;
    }
    case 'advanceYears': {
      if (!world) reset(0);
      if (advancing) break; // one advance at a time (the UI is busy-guarded anyway)
      const run = { cancelled: false };
      advancing = run;
      const total = msg.years;
      // TIME FLOW: advance a year at a time, streaming a snapshot per year so the date
      // ticks and the chronicle scrolls live — watching, not waiting. The yield between
      // years lets a stopAdvance (and read-only inspects) land mid-batch. Chunking is
      // exact: runYears(1)×N is the same tick sequence as runYears(N).
      // CK's rule, baselined: only a decision that APPEARS during the advance holds
      // time — one already on the table when play was pressed must not stall each year.
      const baseline = new Set(pendingDecisionIds(world!));
      const wasAlive = isPlayerAlive(world!);
      const w = world!; // the world THIS advance runs — bail if it is ever replaced
      void (async () => {
        let left = total;
        let interrupted: 'decision' | 'death' | undefined;
        while (left > 0 && !run.cancelled && !interrupted && world === w) {
          runYears(w, 1);
          checkPlayerGoal(w); // fulfilments surface the year they happen…
          reviewPlayerAmbition(w); // …not at the end of the batch
          left--;
          if (wasAlive && !isPlayerAlive(w)) interrupted = 'death';
          else if (pendingDecisionIds(w).some((id) => !baseline.has(id))) interrupted = 'decision';
          if (left > 0 && !interrupted) {
            ctx.postMessage({ kind: 'advance', snapshot: buildSnapshot(w), done: false, total, left });
            await new Promise((r) => setTimeout(r, 0)); // let a stop land
          }
        }
        // a replaced world means someone else owns the stage now — end silently done
        if (world === w) ctx.postMessage({ kind: 'advance', snapshot: buildSnapshot(w), done: true, total, left, interrupted });
        advancing = null;
      })();
      break;
    }
    case 'stopAdvance': {
      if (advancing) advancing.cancelled = true;
      break;
    }
    case 'focusSettlement': {
      if (!world) reset(0);
      focusSettlement(world!, msg.id);
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'setStoryteller': {
      if (!world) reset(0);
      setStoryteller(world!, msg.id);
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'possess': {
      if (!world) reset(0);
      possess(world!, msg.actorId);
      checkPlayerGoal(world!); // baseline the new player's goal (no event)
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'release': {
      if (!world) reset(0);
      release(world!);
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'inherit': {
      if (!world) reset(0);
      inheritHeir(world!); // no-op unless the player is dead and an heir exists
      checkPlayerGoal(world!); // baseline the heir's goal (no event)
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'playerTurn': {
      if (!world) reset(0);
      playerTurn(world!, msg.intent);
      checkPlayerGoal(world!); // the turn may have fulfilled the goal
      reviewPlayerAmbition(world!); // …or the player's committed ambition
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'chooseAmbition': {
      if (!world) reset(0);
      if (world!.playerId !== undefined) chooseAmbition(world!, world!.playerId, msg.ambitionId, msg.target);
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'abandonAmbition': {
      if (!world) reset(0);
      abandonAmbition(world!);
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'save': {
      if (world) {
        await putSave({
          name: msg.name,
          savedAt: Date.now(),
          year: Math.floor(world.tick / DAYS_PER_YEAR),
          seed: world.seed,
          data: serializeWorld(world),
        });
      }
      ctx.postMessage({ kind: 'saveList', saves: await listSaves() });
      break;
    }
    case 'load': {
      const rec = await getSave(msg.name);
      if (rec) world = deserializeWorld(rec.data);
      // ALWAYS answer — the UI sets busy=true on load and only a snapshot clears it.
      // A missing save leaves the current world in place (or a fresh one if none).
      if (!world) reset(0);
      ensureFocusedVenues(world!); // pre-venue saves upgrade lazily (design/25 §3)
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'listSaves': {
      ctx.postMessage({ kind: 'saveList', saves: await listSaves() });
      break;
    }
    case 'inspectActor': {
      ctx.postMessage({
        kind: 'actorDetail',
        detail: world ? inspectActor(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'inspectEvent': {
      ctx.postMessage({
        kind: 'eventChain',
        chain: world ? inspectEvent(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'inspectFigure': {
      ctx.postMessage({
        kind: 'figureDetail',
        detail: world ? inspectFigure(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'inspectSettlement': {
      ctx.postMessage({
        kind: 'settlementDetail',
        detail: world ? inspectSettlement(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'inspectHouse': {
      ctx.postMessage({
        kind: 'houseDetail',
        detail: world ? inspectHouse(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'inspectCulture': {
      ctx.postMessage({
        kind: 'cultureDetail',
        detail: world ? inspectCulture(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'inspectDeity': {
      ctx.postMessage({
        kind: 'deityDetail',
        detail: world ? inspectDeity(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'inspectFeature': {
      ctx.postMessage({
        kind: 'featureDetail',
        detail: world ? inspectFeature(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'peek': {
      ctx.postMessage({
        kind: 'peek',
        token: msg.token,
        card: world ? buildPeek(world, msg.ref) ?? null : null,
      });
      break;
    }
    case 'inspectVenue': {
      ctx.postMessage({
        kind: 'venueDetail',
        detail: world ? inspectVenue(world, msg.id) ?? null : null,
      });
      break;
    }
    case 'localFacts': {
      ctx.postMessage({
        kind: 'localFacts',
        token: msg.token,
        events: world ? buildLocalChronicle(world, msg.id) : [],
        households: world ? buildHouseholds(world, msg.id) : [],
        venues: world ? localVenues(world, msg.id) : [],
      });
      break;
    }
  }
};
