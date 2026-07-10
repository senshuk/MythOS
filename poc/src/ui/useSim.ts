/**
 * React hook owning the sim worker. The UI calls these methods; state arrives
 * back as snapshots. React renders snapshots — it never reaches into sim state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot, ActorDetail, EventChain, FigureDetail, SettlementDetail, HouseDetail, CultureDetail, DeityDetail, FeatureDetail, EventRef, PeekCard } from '../engine/model';
import type { Intent } from '../engine/intent';
import type { SaveMeta } from '../engine/idb';
import type { SimRequest, SimResponse } from '../worker/protocol';

export function useSim(initialSeed: number) {
  const workerRef = useRef<Worker | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [actorDetail, setActorDetail] = useState<ActorDetail | null>(null);
  const [eventChain, setEventChain] = useState<EventChain | null>(null);
  const [figureDetail, setFigureDetail] = useState<FigureDetail | null>(null);
  const [settlementDetail, setSettlementDetail] = useState<SettlementDetail | null>(null);
  const [houseDetail, setHouseDetail] = useState<HouseDetail | null>(null);
  const [cultureDetail, setCultureDetail] = useState<CultureDetail | null>(null);
  const [deityDetail, setDeityDetail] = useState<DeityDetail | null>(null);
  const [featureDetail, setFeatureDetail] = useState<FeatureDetail | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [busy, setBusy] = useState(false);
  // hover peeks resolve out-of-band: each request carries a token; the matching
  // reply settles its promise. Hovering never disturbs the open inspection.
  const peekSeq = useRef(0);
  const peekPending = useRef(new Map<number, (card: PeekCard | null) => void>());

  // clear every open inspection (used on navigation that invalidates them)
  const clearInspect = useCallback(() => {
    setActorDetail(null);
    setEventChain(null);
    setFigureDetail(null);
    setSettlementDetail(null);
    setHouseDetail(null);
    setCultureDetail(null);
    setDeityDetail(null);
    setFeatureDetail(null);
  }, []);

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
      } else if (msg.kind === 'figureDetail') {
        setFigureDetail(msg.detail);
      } else if (msg.kind === 'settlementDetail') {
        setSettlementDetail(msg.detail);
      } else if (msg.kind === 'houseDetail') {
        setHouseDetail(msg.detail);
      } else if (msg.kind === 'cultureDetail') {
        setCultureDetail(msg.detail);
      } else if (msg.kind === 'deityDetail') {
        setDeityDetail(msg.detail);
      } else if (msg.kind === 'featureDetail') {
        setFeatureDetail(msg.detail);
      } else if (msg.kind === 'peek') {
        peekPending.current.get(msg.token)?.(msg.card);
        peekPending.current.delete(msg.token);
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
    clearInspect();
    send({ kind: 'reset', seed });
  }, [send, clearInspect]);

  const genesis = useCallback((seed: number, years: number, storyteller?: string) => {
    setBusy(true);
    clearInspect();
    send({ kind: 'genesis', seed, years, storyteller });
  }, [send, clearInspect]);

  const advance = useCallback((years: number) => {
    setBusy(true);
    send({ kind: 'advanceYears', years });
  }, [send]);

  const focusSettlement = useCallback((id: number) => {
    setBusy(true);
    clearInspect();
    send({ kind: 'focusSettlement', id });
  }, [send, clearInspect]);

  const setStoryteller = useCallback((id: string) => {
    send({ kind: 'setStoryteller', id });
  }, [send]);

  // each inspection clears the others, so the panel shows exactly one thing
  const inspectActor = useCallback((id: number) => { clearInspect(); send({ kind: 'inspectActor', id }); }, [send, clearInspect]);
  const inspectEvent = useCallback((id: number) => { clearInspect(); send({ kind: 'inspectEvent', id }); }, [send, clearInspect]);
  const inspectFigure = useCallback((id: number) => { clearInspect(); send({ kind: 'inspectFigure', id }); }, [send, clearInspect]);
  const inspectSettlement = useCallback((id: number) => { clearInspect(); send({ kind: 'inspectSettlement', id }); }, [send, clearInspect]);
  const inspectHouse = useCallback((id: number) => { clearInspect(); send({ kind: 'inspectHouse', id }); }, [send, clearInspect]);
  const inspectCulture = useCallback((id: string) => { clearInspect(); send({ kind: 'inspectCulture', id }); }, [send, clearInspect]);
  const inspectDeity = useCallback((id: string) => { clearInspect(); send({ kind: 'inspectDeity', id }); }, [send, clearInspect]);
  const inspectFeature = useCallback((id: number) => { clearInspect(); send({ kind: 'inspectFeature', id }); }, [send, clearInspect]);

  /** Dispatch a clicked entity reference to the right inspector. */
  const inspectRef = useCallback((ref: EventRef) => {
    if (ref.kind === 'actor') inspectActor(ref.id);
    else if (ref.kind === 'figure') inspectFigure(ref.id);
    else if (ref.kind === 'house') inspectHouse(ref.id);
    else if (ref.kind === 'culture') inspectCulture(ref.id);
    else if (ref.kind === 'deity') inspectDeity(ref.id);
    else if (ref.kind === 'feature') inspectFeature(ref.id);
    else inspectSettlement(ref.id);
  }, [inspectActor, inspectFigure, inspectSettlement, inspectHouse, inspectCulture, inspectDeity, inspectFeature]);

  /** Ask the worker for a hover card. Resolves null for anything unknown. */
  const peek = useCallback((ref: EventRef) => {
    return new Promise<PeekCard | null>((resolve) => {
      const token = ++peekSeq.current;
      peekPending.current.set(token, resolve);
      workerRef.current?.postMessage({ kind: 'peek', ref, token } satisfies SimRequest);
    });
  }, []);

  const possess = useCallback((actorId: number) => {
    setBusy(true);
    send({ kind: 'possess', actorId });
  }, [send]);

  const release = useCallback(() => {
    setBusy(true);
    send({ kind: 'release' });
  }, [send]);

  // dead player takes up their heir's life (death as a transition, not a game over)
  const inherit = useCallback(() => {
    setBusy(true);
    send({ kind: 'inherit' });
  }, [send]);

  const playerAct = useCallback((intent: Intent) => {
    setBusy(true);
    send({ kind: 'playerTurn', intent });
  }, [send]);

  const chooseAmbition = useCallback((ambitionId: string, target?: number) => {
    setBusy(true);
    send({ kind: 'chooseAmbition', ambitionId, target });
  }, [send]);

  const abandonAmbition = useCallback(() => {
    setBusy(true);
    send({ kind: 'abandonAmbition' });
  }, [send]);

  const save = useCallback((name: string) => {
    send({ kind: 'save', name });
  }, [send]);

  const load = useCallback((name: string) => {
    setBusy(true);
    clearInspect();
    send({ kind: 'load', name });
  }, [send, clearInspect]);

  return {
    snapshot,
    actorDetail,
    eventChain,
    figureDetail,
    settlementDetail,
    houseDetail,
    cultureDetail,
    deityDetail,
    featureDetail,
    saves,
    busy,
    reset,
    genesis,
    advance,
    focusSettlement,
    setStoryteller,
    inspectActor,
    inspectEvent,
    inspectFigure,
    inspectSettlement,
    inspectHouse,
    inspectCulture,
    inspectDeity,
    inspectFeature,
    inspectRef,
    clearInspect,
    peek,
    possess,
    release,
    inherit,
    playerAct,
    chooseAmbition,
    abandonAmbition,
    save,
    load,
  };
}
