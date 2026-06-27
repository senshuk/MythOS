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
  focusSettlement,
  setStoryteller,
  possess,
  release,
  playerTurn,
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
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'release': {
      if (world) release(world);
      ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world!) });
      break;
    }
    case 'playerTurn': {
      if (!world) reset(0);
      playerTurn(world!, msg.intent);
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
      if (rec) {
        world = deserializeWorld(rec.data);
        ctx.postMessage({ kind: 'snapshot', snapshot: buildSnapshot(world) });
      }
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
  }
};
