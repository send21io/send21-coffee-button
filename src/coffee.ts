import { formatFiat, fiatDecimals, toMinor } from "./currencies.js";
import { cleanText } from "./sanitize.js";
import type { Send21Client } from "./send21.js";
import type { Store, StoreData } from "./store.js";
import { CUPS, type Cups, type Order, type OrderStatus, type PayOption } from "./types.js";

export interface CoffeeConfig {
  creator: string;
  price: number;
  currency: string;
  options: PayOption[];
  expiryHours: number;
  shortfallPercent: number;
}

/** Each coffee page and widget form carries a random nonce: the order id. A double tap reuses it. */
export const NONCE = /^[a-z0-9]{20}$/;
export const orderIdFor = (id: string) => `coffee-${id}`;
const ORDER_ID = /^coffee-([a-z0-9]{20})$/;

/** cups × price, in the currency's minor units first so 3 × 0.10 stays 0.30. */
export function priceFor(cups: number, price: number, currency: string): number {
  const scale = 10 ** fiatDecimals(currency);
  return (cups * Math.round(price * scale)) / scale;
}

export type CoffeeInput = { nonce?: unknown; cups?: unknown; message?: unknown };
export type Checked = { ok: true; id: string; cups: Cups; message: string | null } | { ok: false; error: string };

export function checkInput(input: CoffeeInput): Checked {
  const id = String(input.nonce ?? "");
  if (!NONCE.test(id)) return { ok: false, error: "🔁 reload and try again" };
  const cups = Number(input.cups);
  if (!(CUPS as readonly number[]).includes(cups)) return { ok: false, error: "☕ pick 1, 3 or 5" };
  const raw = typeof input.message === "string" ? input.message.trim() : "";
  const message = raw ? cleanText(raw, 80) : null;
  if (raw && !message) return { ok: false, error: "✏️ message: plain text, max 80, no links" };
  return { ok: true, id, cups: cups as Cups, message };
}

/**
 * Create (or return) the pay link for one coffee order. The same nonce with
 * the same cups and message returns the stored link; the orderId doubles as
 * the Idempotency-Key, so a retry after a timeout never makes a second link.
 */
export async function createOrder(store: Store, send21: Send21Client, cfg: CoffeeConfig, input: Extract<Checked, { ok: true }>): Promise<Order> {
  const existing = store.getOrder(input.id);
  if (existing) {
    if (existing.cups !== input.cups || existing.message !== input.message) throw Object.assign(new Error("nonce reused with another order"), { status: 409 });
    if (existing.payUrl) return existing;
  }
  const now = new Date().toISOString();
  const order: Order = existing ?? {
    id: input.id,
    orderId: orderIdFor(input.id),
    cups: input.cups,
    fiatAmount: priceFor(input.cups, cfg.price, cfg.currency),
    fiatCurrency: cfg.currency,
    message: input.message,
    options: cfg.options,
    paymentRequestId: null,
    payUrl: null,
    expiresAt: null,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  store.putOrder(order); // stored before the call: a webhook can always find it
  const pr = await send21.createPaymentRequest(
    {
      fiatCurrency: order.fiatCurrency,
      fiatAmount: order.fiatAmount,
      orderId: order.orderId,
      // Shown on the public pay page. The fan's message stays on this server.
      memo: `☕ ×${order.cups} for ${cfg.creator}`.slice(0, 140),
      options: order.options,
      expiryHours: cfg.expiryHours,
      declineNote: "Nothing happens. It's a coffee, no pressure. ☕",
      ...(cfg.shortfallPercent > 0 ? { shortfallPolicy: { absorbUpToPercent: cfg.shortfallPercent, absorbedBy: "receiver" as const } } : {}),
    },
    order.orderId,
  );
  const next: Order = { ...order, paymentRequestId: pr.id, payUrl: send21.payUrl(pr.payPath), expiresAt: pr.expiresAt, updatedAt: new Date().toISOString() };
  store.putOrder(next);
  return next;
}

// ---------- webhooks ----------

/** Fields of a draft webhook payload that the app reads. See docs/webhooks "Payload". */
export interface DraftEventData {
  status?: string;
  txId?: string;
  sentCurrency?: string;
  network?: string;
  amountSats?: number;
  sentAmount?: string;
  receivedAmountSats?: number;
  receivedAmount?: string;
  fiatCurrency?: string;
  fiatAmount?: number;
  paymentRequestId?: string;
  orderId?: string;
  reviewState?: string;
  occurredAt?: string;
}

const eq = (a: unknown, b: unknown) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const isPosInt = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

/** Compare a draft.confirmed payload with the stored coffee order. Empty = exactly this order. */
export function checkPaymentAgainstOrder(data: DraftEventData, order: Order): string[] {
  const problems: string[] = [];
  if (data.orderId !== order.orderId) problems.push(`orderId ${data.orderId} != ${order.orderId}`);
  if (!order.paymentRequestId || data.paymentRequestId !== order.paymentRequestId) problems.push(`pay link ${data.paymentRequestId} != ${order.paymentRequestId}`);
  if (data.status !== "Confirmed") problems.push(`status ${data.status} != Confirmed`);
  if (!data.txId) problems.push("no txId");
  if (!eq(data.fiatCurrency, order.fiatCurrency)) problems.push(`fiat ${data.fiatCurrency} != ${order.fiatCurrency}`);
  if (typeof data.fiatAmount !== "number" || toMinor(data.fiatAmount, order.fiatCurrency) !== toMinor(order.fiatAmount, order.fiatCurrency)) {
    problems.push(`amount ${data.fiatAmount} != ${order.fiatAmount}`);
  }
  if (!isPosInt(data.amountSats)) problems.push("no amountSats");
  if (data.receivedAmountSats !== undefined && !isPosInt(data.receivedAmountSats)) problems.push("bad receivedAmountSats");
  // sentCurrency is upper case in payloads ("USDC"), options use API enums ("Usdc").
  if (!order.options.some((o) => eq(o.currency, data.sentCurrency) && eq(o.network, data.network))) problems.push(`asset ${data.sentCurrency} on ${data.network} was not offered`);
  return problems;
}

export type Outcome = "test" | "ignored" | "unknown_order" | "unchanged" | "already_paid" | OrderStatus;

/** Apply one verified, de-duplicated event. Call inside store.transaction() with Store.remember(). */
export function applyEvent(d: StoreData, body: { event?: unknown; data?: unknown }, nowIso = new Date().toISOString()): { outcome: Outcome } {
  const event = typeof body.event === "string" ? body.event : "";
  if (event === "test") return { outcome: "test" };
  const data = (body.data && typeof body.data === "object" ? body.data : {}) as DraftEventData;
  const m = typeof data.orderId === "string" ? ORDER_ID.exec(data.orderId) : null;
  if (data.orderId && !m) return { outcome: "unknown_order" }; // another integration's order
  const order = m ? d.orders[m[1]!] : Object.values(d.orders).find((o) => !!data.paymentRequestId && o.paymentRequestId === data.paymentRequestId);
  if (!order || (data.paymentRequestId && data.paymentRequestId !== order.paymentRequestId)) return { outcome: "unknown_order" };

  const set = (status: OrderStatus, extra: Partial<Order> = {}) => {
    d.orders[order.id] = { ...order, ...extra, status, updatedAt: nowIso };
    return { outcome: status };
  };
  const is = (...s: OrderStatus[]) => s.includes(order.status);
  const same = { outcome: "unchanged" as const };

  switch (event) {
    case "draft.confirmed": {
      if (order.status === "paid") return { outcome: "already_paid" };
      const problems = checkPaymentAgainstOrder(data, order);
      if (problems.length) return set("flagged", { problems });
      return set("paid", {
        problems: undefined,
        paid: {
          currency: String(data.sentCurrency),
          network: String(data.network),
          amount: data.receivedAmount ?? data.sentAmount ?? null,
          txId: String(data.txId),
          differentAmount: data.receivedAmountSats !== undefined && data.receivedAmountSats !== data.amountSats,
          at: data.occurredAt ?? nowIso,
        },
      });
    }
    case "draft.seen":
      return is("open", "expired") ? set("seen") : same;
    case "draft.amount_mismatch":
      return is("open", "seen", "expired") ? set("review") : same;
    case "draft.mismatch_accepted":
      return is("paid", "declined") ? same : set("accepted");
    case "draft.mismatch_rejected":
      return is("paid") ? same : set("declined");
    case "draft.mismatch_unresolved":
      return is("open", "seen", "review", "expired") ? set("unresolved") : same;
    case "draft.expired":
      if (data.reviewState === "unresolved") return is("open", "seen", "review", "expired") ? set("unresolved") : same;
      return is("open", "seen") ? set("expired") : same;
    case "payment_request.expired":
      return is("open", "seen") ? set("expired") : same;
    default:
      return { outcome: "ignored" };
  }
}

// ---------- the wall ----------

export interface WallEntry {
  cups: number;
  message: string | null;
  amount: string | null;
  at: string;
}

/** Confirmed payments only, newest first. Hidden entries still count but are not listed. */
export function wall(orders: Order[], { amounts, messages, limit = 100 }: { amounts: boolean; messages: boolean; limit?: number }) {
  const paid = orders.filter((o) => o.status === "paid");
  const entries: WallEntry[] = paid
    .filter((o) => !o.hidden)
    .sort((a, b) => (b.paid?.at ?? b.updatedAt).localeCompare(a.paid?.at ?? a.updatedAt))
    .slice(0, limit)
    .map((o) => ({ cups: o.cups, message: messages ? o.message : null, amount: amounts ? formatFiat(o.fiatAmount, o.fiatCurrency) : null, at: o.paid?.at ?? o.updatedAt }));
  return { coffees: paid.reduce((n, o) => n + o.cups, 0), supporters: paid.length, entries };
}
