import type { AddressInfo } from "node:net";
import type { Express } from "express";
import type { CoffeeConfig } from "../src/coffee.js";
import { parseOptions } from "../src/config.js";
import type { Order } from "../src/types.js";
import { signV2 } from "../src/verify.js";

export const SECRET = "whsec_test_only_not_a_real_secret";
export const NONCE = "abcdefghij0123456789";
export const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

export const coffeeConfig = (over: Partial<CoffeeConfig> = {}): CoffeeConfig => ({
  creator: "tiny-lib",
  price: 3,
  currency: "EUR",
  options: parseOptions("me@wallet.example", `usdc-sol:${SOL}`),
  expiryHours: 24,
  shortfallPercent: 2,
  ...over,
});

/** A ☕×3 order (9 EUR) whose pay link exists: id pr-1. */
export function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: NONCE,
    orderId: `coffee-${NONCE}`,
    cups: 3,
    fiatAmount: 9,
    fiatCurrency: "EUR",
    message: "thanks for the lib 🙌",
    options: coffeeConfig().options,
    paymentRequestId: "pr-1",
    payUrl: "https://send21.io/pay/t1",
    expiresAt: "2026-10-20T10:00:00.000Z",
    status: "open",
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-19T10:00:00.000Z",
    ...over,
  };
}

/** draft.confirmed for makeOrder(), paid over Lightning. Shape from docs/webhooks "Payload". */
export function confirmed(over: Record<string, unknown> = {}) {
  return {
    event: "draft.confirmed",
    data: {
      draftId: "3f6c2a9e-5d1b-4c8e-9a7f-2b4d6e8f0a1c",
      status: "Confirmed",
      txId: "ln-preimage-hash",
      confirmations: 1,
      sentCurrency: "BTC",
      network: "Mainnet",
      amountSats: 15_400,
      sentAmount: "0.00015400",
      fiatCurrency: "EUR",
      fiatAmount: 9,
      paymentRequestId: "pr-1",
      orderId: `coffee-${NONCE}`,
      occurredAt: "2026-10-19T10:05:00.000Z",
      ...over,
    },
  };
}

export async function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export function deliver(url: string, body: unknown, { deliveryId = crypto.randomUUID(), t = Math.floor(Date.now() / 1000), secret = SECRET, raw }: { deliveryId?: string; t?: number; secret?: string; raw?: string } = {}) {
  const payload = raw ?? JSON.stringify(body);
  return fetch(`${url}/webhooks/send21`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-send21-delivery": deliveryId, "x-send21-signature-v2": signV2(payload, deliveryId, t, secret) },
    body: payload,
  });
}
