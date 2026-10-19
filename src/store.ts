import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Order } from "./types.js";

// One JSON file, written atomically (temp file + rename). Every change runs in
// `transaction()`: memory is changed, the file is written, and only then does
// the caller answer send21 with 2xx. If the write fails, the state is reloaded
// from disk and the error is thrown (send21 retries later).
// Good for one process. For several, use SQLite or Postgres
// (see send21-examples/examples/webhook-receiver-sqlite).

export interface StoreData {
  version: 1;
  orders: Record<string, Order>;
  /** X-Send21-Delivery id -> first seen (ms) */
  deliveries: Record<string, number>;
  /** sha256 of the raw body -> first seen (ms): the same event under a new delivery id */
  events: Record<string, number>;
}

const empty = (): StoreData => ({ version: 1, orders: {}, deliveries: {}, events: {} });
const KEEP_MS = 30 * 24 * 3600_000;

export class Store {
  private data: StoreData;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  private load(): StoreData {
    if (this.file === ":memory:" || !existsSync(this.file)) return empty();
    return { ...empty(), ...(JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoreData>), version: 1 };
  }

  private persist(): void {
    if (this.file === ":memory:") return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** Run fn against the data and write it. All or nothing. */
  transaction<T>(fn: (d: StoreData) => T): T {
    try {
      const result = fn(this.data);
      this.persist();
      return result;
    } catch (err) {
      this.data = this.load();
      throw err;
    }
  }

  getOrder(id: string): Order | undefined {
    return this.data.orders[id];
  }

  putOrder(order: Order): void {
    this.transaction((d) => {
      d.orders[order.id] = order;
    });
  }

  orders(): Order[] {
    return Object.values(this.data.orders);
  }

  /** Remember a verified delivery inside a transaction. False when already handled. */
  static remember(d: StoreData, deliveryId: string, eventKey: string, now = Date.now()): boolean {
    if (d.deliveries[deliveryId] !== undefined || d.events[eventKey] !== undefined) return false;
    d.deliveries[deliveryId] = now;
    d.events[eventKey] = now;
    for (const map of [d.deliveries, d.events]) {
      for (const [k, at] of Object.entries(map)) if (now - at > KEEP_MS) delete map[k];
    }
    return true;
  }
}
