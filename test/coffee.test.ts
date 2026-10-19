import { describe, expect, it } from "vitest";
import { checkInput, createOrder, priceFor, wall } from "../src/coffee.js";
import { createMockClient } from "../src/send21.js";
import { Store } from "../src/store.js";
import { coffeeConfig, makeOrder, NONCE } from "./helpers.js";

describe("checkInput", () => {
  it("accepts 1, 3 or 5 cups and an optional plain message", () => {
    expect(checkInput({ nonce: NONCE, cups: "5", message: "  keep going 🚀 " })).toEqual({ ok: true, id: NONCE, cups: 5, message: "keep going 🚀" });
    expect(checkInput({ nonce: NONCE, cups: 1 })).toMatchObject({ ok: true, message: null });
  });
  it("refuses everything else", () => {
    for (const cups of [0, 2, 4, 6, 100, -1, 1.5, "x", null]) expect(checkInput({ nonce: NONCE, cups }).ok).toBe(false);
    for (const nonce of ["", "short", "ABCDEFGHIJ0123456789", `${NONCE}x`, "abcdefghij012345678!", 42]) expect(checkInput({ nonce, cups: 1 }).ok).toBe(false);
    for (const message of ["see https://evil.example", "<b>hi</b>", "x".repeat(81), "visit www.spam.example"]) expect(checkInput({ nonce: NONCE, cups: 1, message }).ok).toBe(false);
  });
});

describe("priceFor", () => {
  it("multiplies in minor units", () => {
    expect(priceFor(3, 3, "EUR")).toBe(9);
    expect(priceFor(3, 0.1, "EUR")).toBe(0.3);
    expect(priceFor(5, 2.99, "USD")).toBe(14.95);
    expect(priceFor(3, 500, "JPY")).toBe(1500);
  });
});

describe("createOrder", () => {
  const input = { ok: true as const, id: NONCE, cups: 3 as const, message: "hi" };

  it("sends a documented, fiat-priced pay link with the orderId as Idempotency-Key", async () => {
    const send21 = createMockClient("http://localhost");
    const calls: [unknown, string][] = [];
    const orig = send21.createPaymentRequest;
    send21.createPaymentRequest = (b, k) => (calls.push([b, k]), orig(b, k));
    const order = await createOrder(new Store(":memory:"), send21, coffeeConfig(), input);
    expect(order.payUrl).toMatch(/^http:\/\/localhost\/mock\/pay\//);
    expect(calls).toHaveLength(1);
    const [body, key] = calls[0]!;
    expect(key).toBe(`coffee-${NONCE}`);
    expect(body).toEqual({
      fiatCurrency: "EUR",
      fiatAmount: 9,
      orderId: `coffee-${NONCE}`,
      memo: "☕ ×3 for tiny-lib",
      options: [
        { currency: "Btc", network: "Mainnet", address: "me@wallet.example", method: "Lightning" },
        { currency: "Usdc", network: "Solana", address: expect.any(String) },
      ],
      expiryHours: 24,
      declineNote: expect.any(String),
      shortfallPolicy: { absorbUpToPercent: 2, absorbedBy: "receiver" },
    });
    // The fan's message is not sent to send21.
    expect(JSON.stringify(body)).not.toContain("hi\"");
  });

  it("a double tap returns the same link, a reused nonce with other data is 409", async () => {
    const store = new Store(":memory:");
    const send21 = createMockClient("http://localhost");
    const a = await createOrder(store, send21, coffeeConfig(), input);
    const b = await createOrder(store, send21, coffeeConfig(), input);
    expect(b.payUrl).toBe(a.payUrl);
    expect(send21.requests.size).toBe(1);
    await expect(createOrder(store, send21, coffeeConfig(), { ...input, cups: 5 })).rejects.toMatchObject({ status: 409 });
    await expect(createOrder(store, send21, coffeeConfig(), { ...input, message: "other" })).rejects.toMatchObject({ status: 409 });
  });

  it("stores the order before calling send21 and retries with the same key after a failure", async () => {
    const store = new Store(":memory:");
    const send21 = createMockClient("http://localhost");
    const orig = send21.createPaymentRequest;
    const keys: string[] = [];
    send21.createPaymentRequest = async (b, k) => {
      keys.push(k);
      expect(store.getOrder(NONCE)?.status).toBe("open");
      if (keys.length === 1) throw new Error("timeout");
      return orig(b, k);
    };
    await expect(createOrder(store, send21, coffeeConfig(), input)).rejects.toThrow("timeout");
    expect((await createOrder(store, send21, coffeeConfig(), input)).payUrl).toBeTruthy();
    expect(keys).toEqual([`coffee-${NONCE}`, `coffee-${NONCE}`]);
  });
});

describe("wall", () => {
  const paid = (id: string, cups: 1 | 3 | 5, at: string, over = {}) =>
    makeOrder({ id, cups, fiatAmount: cups * 3, status: "paid", paid: { currency: "BTC", network: "Mainnet", amount: "0.0001", txId: "t", differentAmount: false, at }, ...over });
  const orders = [
    paid("a", 1, "2026-10-19T10:00:00Z", { message: "first!" }),
    paid("b", 5, "2026-10-19T12:00:00Z", { message: "legend" }),
    paid("c", 3, "2026-10-19T11:00:00Z", { hidden: true, message: "hidden one" }),
    makeOrder({ id: "d", status: "seen", message: "not yet" }),
    makeOrder({ id: "e", status: "flagged", message: "wrong amount" }),
    makeOrder({ id: "f", status: "accepted", message: "accepted mismatch, not confirmed yet" }),
  ];

  it("lists confirmed payments only, newest first, hidden ones counted but not listed", () => {
    const w = wall(orders, { amounts: false, messages: true });
    expect(w.coffees).toBe(9);
    expect(w.supporters).toBe(3);
    expect(w.entries.map((e) => e.message)).toEqual(["legend", "first!"]);
    expect(w.entries.every((e) => e.amount === null)).toBe(true);
  });

  it("respects the amounts and messages flags", () => {
    const w = wall(orders, { amounts: true, messages: false });
    expect(w.entries.map((e) => e.amount)).toEqual(["15.00 EUR", "3.00 EUR"]);
    expect(w.entries.every((e) => e.message === null)).toBe(true);
  });
});
