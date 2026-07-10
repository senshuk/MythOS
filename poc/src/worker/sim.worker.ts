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
      runYears(world!, msg.years);
      checkPlayerGoal(world!); // a goal may have been fulfilled while time passed
      reviewPlayerAmbition(world!); // …as may the player's committed ambition
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
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
  }
};
