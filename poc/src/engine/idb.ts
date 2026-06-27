/**
 * Minimal IndexedDB save store — a tiny promisified wrapper, no dependency. Runs
 * in the worker (which has IndexedDB). Keeps the *pure* serializer (persistence.ts,
 * Node-testable) separate from this browser-only storage layer. Each save is one
 * record keyed by name, carrying display metadata + the serialized world.
 */
import { type SaveFile } from './persistence';

const DB_NAME = 'mythos';
const STORE = 'saves';
const DB_VERSION = 1;

export interface SaveRecord {
  name: string;
  savedAt: number; // wall-clock ms — metadata only, never touches the sim
  year: number;
  seed: number;
  data: SaveFile;
}

/** Lightweight listing metadata (no world payload). */
export type SaveMeta = Pick<SaveRecord, 'name' | 'savedAt' | 'year' | 'seed'>;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putSave(rec: SaveRecord): Promise<void> {
  const db = await openDB();
  try {
    await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec));
  } finally {
    db.close();
  }
}

export async function getSave(name: string): Promise<SaveRecord | undefined> {
  const db = await openDB();
  try {
    return (await promisify(db.transaction(STORE, 'readonly').objectStore(STORE).get(name))) ?? undefined;
  } finally {
    db.close();
  }
}

export async function deleteSave(name: string): Promise<void> {
  const db = await openDB();
  try {
    await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(name));
  } finally {
    db.close();
  }
}

/** All saves' metadata (no world payloads), most recent first. */
export async function listSaves(): Promise<SaveMeta[]> {
  const db = await openDB();
  try {
    const all = await promisify<SaveRecord[]>(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<SaveRecord[]>,
    );
    return all
      .map(({ name, savedAt, year, seed }) => ({ name, savedAt, year, seed }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    db.close();
  }
}
