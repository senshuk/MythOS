/**
 * The UI <-> simulation message contract. The UI sends INTENTS (serializable
 * commands); the worker replies with SNAPSHOTS / inspections. No shared mutable
 * objects cross this boundary — this single rule is what preserves determinism,
 * keeps the UI a pure function of state, and leaves the door open to replay and
 * (eventually) multiplayer.
 */
import type { Snapshot, ActorDetail, EventChain, FigureDetail, SettlementDetail, HouseDetail, CultureDetail, DeityDetail, FeatureDetail } from '../engine/model';
import type { Intent } from '../engine/intent';
import type { SaveMeta } from '../engine/idb';

export type SimRequest =
  | { kind: 'init'; seed: number }
  | { kind: 'reset'; seed: number }
  | { kind: 'genesis'; seed: number; years: number; storyteller?: string }
  | { kind: 'advanceYears'; years: number }
  | { kind: 'focusSettlement'; id: number }
  | { kind: 'setStoryteller'; id: string }
  | { kind: 'inspectActor'; id: number }
  | { kind: 'inspectEvent'; id: number }
  | { kind: 'inspectFigure'; id: number }
  | { kind: 'inspectSettlement'; id: number }
  | { kind: 'inspectHouse'; id: number }
  | { kind: 'inspectCulture'; id: string }
  | { kind: 'inspectDeity'; id: string }
  | { kind: 'inspectFeature'; id: number }
  // --- player-as-actor control loop ---
  | { kind: 'possess'; actorId: number }
  | { kind: 'release' }
  | { kind: 'playerTurn'; intent: Intent }
  | { kind: 'chooseAmbition'; ambitionId: string; target?: number }
  | { kind: 'abandonAmbition' }
  // --- persistence (save/load) ---
  | { kind: 'save'; name: string }
  | { kind: 'load'; name: string }
  | { kind: 'listSaves' };

export type SimResponse =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'actorDetail'; detail: ActorDetail | null }
  | { kind: 'eventChain'; chain: EventChain | null }
  | { kind: 'figureDetail'; detail: FigureDetail | null }
  | { kind: 'settlementDetail'; detail: SettlementDetail | null }
  | { kind: 'houseDetail'; detail: HouseDetail | null }
  | { kind: 'cultureDetail'; detail: CultureDetail | null }
  | { kind: 'deityDetail'; detail: DeityDetail | null }
  | { kind: 'featureDetail'; detail: FeatureDetail | null }
  | { kind: 'saveList'; saves: SaveMeta[] };
