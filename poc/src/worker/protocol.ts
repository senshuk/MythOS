/**
 * The UI <-> simulation message contract. The UI sends INTENTS (serializable
 * commands); the worker replies with SNAPSHOTS / inspections. No shared mutable
 * objects cross this boundary — this single rule is what preserves determinism,
 * keeps the UI a pure function of state, and leaves the door open to replay and
 * (eventually) multiplayer.
 */
import type { Snapshot, ActorDetail, EventChain } from '../engine/model';

export type SimRequest =
  | { kind: 'init'; seed: number }
  | { kind: 'reset'; seed: number }
  | { kind: 'genesis'; seed: number; years: number; storyteller?: string }
  | { kind: 'advanceYears'; years: number }
  | { kind: 'focusSettlement'; id: number }
  | { kind: 'setStoryteller'; id: string }
  | { kind: 'inspectActor'; id: number }
  | { kind: 'inspectEvent'; id: number };

export type SimResponse =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'actorDetail'; detail: ActorDetail | null }
  | { kind: 'eventChain'; chain: EventChain | null };
