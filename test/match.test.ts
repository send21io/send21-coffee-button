import { describe, expect, it } from "vitest";
import { applyEvent, checkPaymentAgainstOrder } from "../src/coffee.js";
import type { StoreData } from "../src/store.js";
import type { OrderStatus } from "../src/types.js";
import { confirmed, makeOrder, NONCE } from "./helpers.js";

const data = (status: OrderStatus = "open"): StoreData => ({ version: 1, orders: { [NONCE]: makeOrder({ status }) }, deliveries: {}, events: {} });

describe("checkPaymentAgainstOrder", () => {
  it("accepts exactly this order, over Lightning or USDC", () => {
    expect(checkPaymentAgainstOrder(confirmed().data, makeOrder())).toEqual([]);
    expect(checkPaymentAgainstOrder(confirmed({ sentCurrency: "USDC", network: "Solana" }).data, makeOrder())).toEqual([]);
  });
  it.each([
    ["amount for 1 coffee, not 3", { fiatAmount: 3 }],
    ["another fiat", { fiatCurrency: "USD" }],
    ["a coin that was not offered", { sentCurrency: "ETH", network: "Base" }],
    ["USDT on Solana, not offered here", { sentCurrency: "USDT", network: "Solana" }],
    ["another pay link", { paymentRequestId: "pr-2" }],
    ["not confirmed", { status: "Seen" }],
    ["no tx", { txId: "" }],
    ["no amount", { amountSats: 0 }],
    ["fractional sats", { amountSats: 1.5 }],
  ])("flags %s", (_n, over) => {
    expect(checkPaymentAgainstOrder(confirmed(over).data, makeOrder()).length).toBeGreaterThan(0);
  });
});

describe("applyEvent", () => {
  it("draft.confirmed → paid, once", () => {
    const d = data();
    expect(applyEvent(d, confirmed())).toEqual({ outcome: "paid" });
    expect(d.orders[NONCE]!.paid).toMatchObject({ currency: "BTC", network: "Mainnet", txId: "ln-preimage-hash" });
    expect(applyEvent(d, confirmed({ fiatAmount: 1 }))).toEqual({ outcome: "already_paid" });
    expect(d.orders[NONCE]!.status).toBe("paid");
  });
  it("a wrong amount or asset is flagged, never paid (so never on the wall)", () => {
    const d = data();
    expect(applyEvent(d, confirmed({ fiatAmount: 3 }))).toEqual({ outcome: "flagged" });
    expect(d.orders[NONCE]!.problems?.join()).toMatch(/amount/);
  });
  it("ignores other integrations' orders and unknown events", () => {
    const d = data();
    expect(applyEvent(d, confirmed({ orderId: "split-abc-1" }))).toEqual({ outcome: "unknown_order" });
    expect(applyEvent(d, confirmed({ orderId: "coffee-zzzzzzzzzzzzzzzzzzzz" }))).toEqual({ outcome: "unknown_order" });
    expect(applyEvent(d, { event: "draft.created", data: { orderId: `coffee-${NONCE}` } })).toEqual({ outcome: "ignored" });
    expect(applyEvent(d, { event: "test", data: {} })).toEqual({ outcome: "test" });
    expect(d.orders[NONCE]!.status).toBe("open");
  });
  it("finds the order by paymentRequestId when orderId is missing", () => {
    const d = data();
    expect(applyEvent(d, { event: "payment_request.expired", data: { paymentRequestId: "pr-1" } })).toEqual({ outcome: "expired" });
  });
  it("walks the review states and never leaves paid", () => {
    const d = data();
    applyEvent(d, { event: "draft.seen", data: { orderId: `coffee-${NONCE}` } });
    expect(d.orders[NONCE]!.status).toBe("seen");
    applyEvent(d, { event: "draft.amount_mismatch", data: { orderId: `coffee-${NONCE}` } });
    expect(d.orders[NONCE]!.status).toBe("review");
    applyEvent(d, { event: "draft.mismatch_accepted", data: { orderId: `coffee-${NONCE}` } });
    expect(d.orders[NONCE]!.status).toBe("accepted");
    applyEvent(d, confirmed());
    expect(d.orders[NONCE]!.status).toBe("paid");
    for (const event of ["draft.expired", "draft.mismatch_rejected", "payment_request.expired", "draft.seen"]) applyEvent(d, { event, data: { orderId: `coffee-${NONCE}` } });
    expect(d.orders[NONCE]!.status).toBe("paid");
  });
  it("a payment that lands after expiry still counts", () => {
    const d = data("expired");
    expect(applyEvent(d, confirmed())).toEqual({ outcome: "paid" });
  });
});
