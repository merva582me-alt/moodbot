/**
 * MoodBot Persistence Engine
 * Provides IndexedDB storage for large binary/base64 soundboard clips,
 * and LocalStorage for instant state hydration on startup.
 * All settings are stored locally — no external server required.
 */

import { AudioMixerState, EngagementAlertConfig, SoundTrigger, TTSConfig } from '../types';

const DB_NAME = 'MoodBotPersistenceDB';
const DB_VERSION = 1;
const STORE_NAME = 'app_settings';

// Helper to open IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Save a key-value pair to IndexedDB
export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[Persistence Engine] IndexedDB set error:', err);
  }
}

// Get a key-value pair from IndexedDB
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[Persistence Engine] IndexedDB get error:', err);
    return undefined;
  }
}
