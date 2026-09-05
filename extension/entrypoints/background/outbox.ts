import type { Event } from "@qua/protocol";
import { openDb, reqToPromise, txDone } from "./idb.js";

/**
 * Outbox durable en IndexedDB (§04 Resiliencia).
 *
 * Cada lote de eventos se persiste con su `seq` ANTES de intentar mandarlo por WS.
 * Solo se borra cuando llega un `ack` con seq ≥ el suyo. `nextSeq` vive en un store
 * aparte porque, una vez ackeado y borrado un lote, su `seq` desaparece de `batches`
 * — sin un contador persistido, un reciclado del service worker haría que el
 * siguiente lote reusara un `seq` ya confirmado.
 */
export interface OutboxBatch {
  seq: number;
  items: Event[];
  queuedAt: number;
}

const BATCHES_STORE = "batches";
const META_STORE = "meta";
const NEXT_SEQ_KEY = "nextSeq";

export class Outbox {
  private dbPromise: Promise<IDBDatabase>;

  constructor(dbName = "qua-outbox") {
    this.dbPromise = openDb(dbName, 1, (db) => {
      if (!db.objectStoreNames.contains(BATCHES_STORE)) {
        db.createObjectStore(BATCHES_STORE, { keyPath: "seq" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    });
  }

  /** Reserva el próximo `seq` monótono y lo persiste antes de devolverlo. */
  async nextSeq(): Promise<number> {
    const db = await this.dbPromise;
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const current = await reqToPromise<{ key: string; value: number } | undefined>(
      store.get(NEXT_SEQ_KEY),
    );
    const seq = (current?.value ?? 0) + 1;
    store.put({ key: NEXT_SEQ_KEY, value: seq });
    await txDone(tx);
    return seq;
  }

  /** Escribe el lote en disco. Se llama SIEMPRE antes de intentar el `send` (§04). */
  async enqueue(seq: number, items: Event[], queuedAt: number): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(BATCHES_STORE, "readwrite");
    tx.objectStore(BATCHES_STORE).put({ seq, items, queuedAt } satisfies OutboxBatch);
    await txDone(tx);
  }

  /** Borra todo lote con `seq` ≤ `ackedSeq` (§04: "solo se borran al recibir ack con seq ≥"). */
  async ack(ackedSeq: number): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(BATCHES_STORE, "readwrite");
    const store = tx.objectStore(BATCHES_STORE);
    const range = IDBKeyRange.upperBound(ackedSeq);
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    await txDone(tx);
  }

  /** Todos los lotes aún sin ackear, en orden de `seq` — lo que hay que replayear. */
  async pending(): Promise<OutboxBatch[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(BATCHES_STORE, "readonly");
    const all = await reqToPromise<OutboxBatch[]>(tx.objectStore(BATCHES_STORE).getAll());
    return all.sort((a, b) => a.seq - b.seq);
  }

  /** Vacía outbox y contador. Se usa al arrancar una sesión nueva (§DECISIONS A2-01). */
  async reset(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction([BATCHES_STORE, META_STORE], "readwrite");
    tx.objectStore(BATCHES_STORE).clear();
    tx.objectStore(META_STORE).clear();
    await txDone(tx);
  }

  async close(): Promise<void> {
    const db = await this.dbPromise;
    db.close();
  }
}
