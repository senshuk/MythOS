/**
 * The UI <-> simulation message contract. The UI sends INTENTS (serializable
 * commands); the worker replies with SNAPSHOTS / inspections. No shared mutable
 * objects cross this boundary — this single rule is what preserves determinism,
 * keeps the UI a pure function of state, and leaves the door open to replay and
 * (eventually) multiplayer.
 */
import type { Snapshot, ActorDetail, EventChain, FigureDetail, SettlementDetail, HouseDetail, CultureDetail, DeityDetail, FeatureDetail, VenueDetail, EventRef, PeekCard, EventView, HouseholdView } from '../engine/model';

/** A settlement's public venue, as the close view lists them (its buildings link here). */
export interface LocalVenue {
  id: number;
  name: string;
  meaning?: string;
  type: string;
}
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
  | { kind: 'inspectVenue'; id: number }
  // a hover peek — a tiny card, separate from the inspector so hovering never
  // disturbs what the player has open. `token` pairs the reply with its request.
  | { kind: 'peek'; ref: EventRef; token: number }
  // one settlement's close-view facts — its notable history (HISTORY MARKS) and,
  // when it is the lived-in-full settlement, its HOUSEHOLDS (who lives under which
  // roof). Out-of-band like peek, so entering a town never disturbs the inspector.
  | { kind: 'localFacts'; id: number; token: number }
  // --- player-as-actor control loop ---
  | { kind: 'possess'; actorId: number }
  | { kind: 'release' }
  | { kind: 'inherit' } // dead player takes up their heir's life (death as a transition)
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
  | { kind: 'venueDetail'; detail: VenueDetail | null }
  | { kind: 'peek'; token: number; card: PeekCard | null }
  | { kind: 'localFacts'; token: number; events: EventView[]; households: HouseholdView[]; venues: LocalVenue[] }
  | { kind: 'saveList'; saves: SaveMeta[] };
