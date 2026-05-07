/* ============================================================
   Grok Auto – Storage Layer
   chrome.storage.local for queue metadata
   IndexedDB for image blobs
   ============================================================ */

import { QueueObject, QueueSettings, LogEntry, DEFAULT_SETTINGS } from '../types';

// ── Storage keys ──
const KEYS = {
  QUEUES: 'grokauto_queues',
  COUNTER: 'grokauto_queue_counter',
  SETTINGS: 'grokauto_settings',
  LOGS: 'grokauto_logs',
  ACTIVE_QUEUE: 'grokauto_active_queue',
};

// ── chrome.storage.local wrappers ──
async function storageGet<T>(key: string, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    chrome.storage.local.get(key, (result: any) => {
      resolve(result[key] !== undefined ? result[key] : fallback);
    });
  });
}

async function storageSet(items: Record<string, any>): Promise<void> {
  return new Promise<void>(resolve => {
    chrome.storage.local.set(items, () => resolve());
  });
}

// ── Queue counter ──
export async function getNextQueueName(): Promise<string> {
  const counter = await storageGet<number>(KEYS.COUNTER, 1);
  const name = `GROK${counter}`;
  await storageSet({ [KEYS.COUNTER]: counter + 1 });
  return name;
}

// ── Queue mutation lock ──
let _queueLock: Promise<void> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _queueLock;
  let resolve: () => void;
  _queueLock = new Promise(r => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

// ── Queues CRUD ──
export async function getAllQueues(): Promise<QueueObject[]> {
  return storageGet<QueueObject[]>(KEYS.QUEUES, []);
}

export async function saveAllQueues(queues: QueueObject[]): Promise<void> {
  await storageSet({ [KEYS.QUEUES]: queues });
}

export async function getQueueById(id: string): Promise<QueueObject | null> {
  const queues = await getAllQueues();
  return queues.find(q => q.id === id) || null;
}

export async function addQueue(queue: QueueObject): Promise<void> {
  return withQueueLock(async () => {
    const queues = await getAllQueues();
    if (queues.length >= 50) throw new Error('Queue limit reached (50).');
    if (queue.prompts.length > 500) throw new Error('Too many prompts (max 500).');
    queues.push(queue);
    await saveAllQueues(queues);
  });
}

export async function updateQueue(updated: QueueObject): Promise<void> {
  return withQueueLock(async () => {
    const queues = await getAllQueues();
    const idx = queues.findIndex(q => q.id === updated.id);
    if (idx >= 0) {
      queues[idx] = updated;
      await saveAllQueues(queues);
    }
  });
}

export async function deleteQueue(id: string): Promise<void> {
  return withQueueLock(async () => {
    let queues = await getAllQueues();
    queues = queues.filter(q => q.id !== id);
    await saveAllQueues(queues);
  });
}

// ── Active queue tracking ──
export async function getActiveQueueId(): Promise<string | null> {
  return storageGet<string | null>(KEYS.ACTIVE_QUEUE, null);
}

export async function setActiveQueueId(id: string | null): Promise<void> {
  await storageSet({ [KEYS.ACTIVE_QUEUE]: id });
}

// ── Settings ──
export async function getSettings(): Promise<QueueSettings> {
  const raw = await storageGet<any>(KEYS.SETTINGS, DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...raw };
}

export async function saveSettings(settings: QueueSettings): Promise<void> {
  await storageSet({ [KEYS.SETTINGS]: settings });
}

// ── Logs ──
export async function getLogs(): Promise<LogEntry[]> {
  return storageGet<LogEntry[]>(KEYS.LOGS, []);
}

export async function appendLog(entry: LogEntry): Promise<void> {
  const logs = await getLogs();
  logs.push(entry);
  if (logs.length > 2000) logs.splice(0, logs.length - 2000);
  await storageSet({ [KEYS.LOGS]: logs });
}

export async function clearLogs(): Promise<void> {
  await storageSet({ [KEYS.LOGS]: [] });
}

// ================================================================
// IndexedDB – Image Blob Storage
// ================================================================

const IDB_NAME = 'grokauto_images';
const IDB_STORE = 'blobs';
const IDB_VERSION = 1;

let _idbInstance: IDBDatabase | null = null;

function openIDB(): Promise<IDBDatabase> {
  if (_idbInstance) return Promise.resolve(_idbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      _idbInstance = request.result;
      _idbInstance.onclose = () => { _idbInstance = null; };
      resolve(_idbInstance);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveImageBlob(id: string, blob: Blob): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ id, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getImageBlob(id: string): Promise<Blob | null> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteImageBlob(id: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
