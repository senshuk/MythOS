/**
 * React hook owning the sim worker. The UI calls these methods; state arrives
 * back as snapshots. React renders snapshots — it never reaches into sim state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot, ActorDetail, EventChain } from '../engine/model';
import type { Intent } from '../engine/intent';
import type { SaveMeta } from '../engine/idb';
import type { SimRequest, SimResponse } from '../worker/protocol';

export function useSim(initialSeed: number) {
  const workerRef = useRef<Worker | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [actorDetail, setActorDetail] = useState<ActorDetail | null>(null);
  const [eventChain, setEventChain] = useState<EventChain | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<SimResponse>) => {
      const msg = e.data;
      if (msg.kind === 'snapshot') {
        setSnapshot(msg.snapshot);
        setBusy(false);
      } else if (msg.kind === 'actorDetail') {
        setActorDetail(msg.detail);
      } else if (msg.kind === 'eventChain') {
        setEventChain(msg.chain);
      } else if (msg.kind === 'saveList') {
        setSaves(msg.saves);
      }
    };
    worker.postMessage({ kind: 'init', seed: initialSeed } satisfies SimRequest);
    worker.postMessage({ kind: 'listSaves' } satisfies SimRequest);
    return () => worker.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback((req: SimRequest) => {
    workerRef.current?.postMessage(req);
  }, []);

  const reset = useCallback((seed: number) => {
    setBusy(true);
    setActorDetail(null);
    setEventChain(null);
    send({ kind: 'reset', seed });
  }, [send]);

  const genesis = useCallback((seed: number, years: number, storyteller?: string) => {
    setBusy(true);
    setActorDetail(null);
    setEventChain(null);
    send({ kind: 'genesis', seed, years, storyteller });
  }, [send]);

  const advance = useCallback((years: number) => {
    setBusy(true);
    send({ kind: 'advanceYears', years });
  }, [send]);

  const focusSettlement = useCallback((id: number) => {
    setBusy(true);
    setActorDetail(null);
    setEventChain(null);
    send({ kind: 'focusSettlement', id });
  }, [send]);

  const setStoryteller = useCallback((id: string) => {
    send({ kind: 'setStoryteller', id });
  }, [send]);

  const inspectActor = useCallback((id: number) => {
    setEventChain(null);
    send({ kind: 'inspectActor', id });
  }, [send]);

  const inspectEvent = useCallback((id: number) => {
    setActorDetail(null);
    send({ kind: 'inspectEvent', id });
  }, [send]);

  const clearInspect = useCallback(() => {
    setActorDetail(null);
    setEventChain(null);
  }, []);

  const possess = useCallback((actorId: number) => {
    setBusy(true);
    send({ kind: 'possess', actorId });
  }, [send]);

  const release = useCallback(() => {
    setBusy(true);
    send({ kind: 'release' });
  }, [send]);

  const playerAct = useCallback((intent: Intent) => {
    setBusy(true);
    send({ kind: 'playerTurn', intent });
  }, [send]);

  const save = useCallback((name: string) => {
    send({ kind: 'save', name });
  }, [send]);

  const load = useCallback((name: string) => {
    setBusy(true);
    setActorDetail(null);
    setEventChain(null);
    send({ kind: 'load', name });
  }, [send]);

  return {
    snapshot,
    actorDetail,
    eventChain,
    saves,
    busy,
    reset,
    genesis,
    advance,
    focusSettlement,
    setStoryteller,
    inspectActor,
    inspectEvent,
    clearInspect,
    possess,
    release,
    playerAct,
    save,
    load,
  };
}
