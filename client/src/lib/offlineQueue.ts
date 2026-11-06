/** IndexedDB offline queue for SOS and responder updates — never reports false "sent". */
const DB_NAME = 'sv-dispatch-offline';
const STORE = 'queue';
const DB_VERSION = 1;

export type QueueItem = {
  id: string;
  kind: 'sos' | 'status' | 'note' | 'location';
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  state: 'queued' | 'sending' | 'sent' | 'failed';
  lastError?: string;
  retries: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueue(item: Omit<QueueItem, 'state' | 'retries' | 'createdAt'> & { state?: QueueItem['state'] }) {
  const full: QueueItem = {
    ...item,
    state: item.state ?? 'queued',
    retries: 0,
    createdAt: new Date().toISOString(),
  };
  await withStore('readwrite', (s) => s.put(full));
  return full;
}

export async function listQueue(): Promise<QueueItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueueItem[]);
    req.onerror = () => reject(req.error);
  });
}

export async function updateQueueItem(id: string, patch: Partial<QueueItem>) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const cur = get.result as QueueItem | undefined;
      if (!cur) return resolve();
      store.put({ ...cur, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeQueueItem(id: string) {
  await withStore('readwrite', (s) => s.delete(id));
}

/** Flush queued SOS items when back online. Uses stored idempotency keys. */
export async function flushSosQueue(
  createSos: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>
): Promise<{ sent: number; failed: number }> {
  const items = (await listQueue()).filter((i) => i.kind === 'sos' && i.state !== 'sent');
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await updateQueueItem(item.id, { state: 'sending' });
      await createSos(item.payload, item.idempotencyKey);
      await removeQueueItem(item.id);
      sent += 1;
    } catch (err) {
      failed += 1;
      await updateQueueItem(item.id, {
        state: 'failed',
        retries: item.retries + 1,
        lastError: err instanceof Error ? err.message : 'Send failed',
      });
    }
  }
  return { sent, failed };
}
