import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient } from "../src/send21.js";
import { createApp } from "../src/server.js";
import { Store } from "../src/store.js";
import { coffeeConfig, confirmed, deliver, listen, makeOrder, NONCE, SECRET } from "./helpers.js";

let dir: string;
let file: string;
let server: Awaited<ReturnType<typeof listen>>;
let store: Store;
let mock: ReturnType<typeof createMockClient>;
const status = () => store.getOrder(NONCE)!.status;

async function start(wall = { amounts: false, messages: true }) {
  store = new Store(file);
  mock = createMockClient("http://localhost");
  server = await listen(createApp({ store, send21: mock, secret: SECRET, coffee: coffeeConfig(), wall, publicUrl: "http://localhost", log: () => undefined }));
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "coffee-"));
  file = join(dir, "coffee.json");
  new Store(file).putOrder(makeOrder());
  await start();
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("webhook", () => {
  it("a confirmed payment lands on the wall", async () => {
    const r = await deliver(server.url, confirmed());
    expect(await r.json()).toEqual({ ok: true, outcome: "paid" });
    const w = await (await fetch(`${server.url}/api/wall`)).json();
    expect(w).toMatchObject({ coffees: 3, supporters: 1, entries: [{ cups: 3, message: "thanks for the lib 🙌", amount: null }] });
    expect(await (await fetch(`${server.url}/wall`)).text()).toContain("thanks for the lib 🙌");
  });

  it("401 for a bad signature, another secret or an old delivery, and nothing stored", async () => {
    expect((await deliver(server.url, confirmed(), { secret: "nope" })).status).toBe(401);
    expect((await deliver(server.url, confirmed(), { t: Math.floor(Date.now() / 1000) - 301 })).status).toBe(401);
    const r = await fetch(`${server.url}/webhooks/send21`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(confirmed()) });
    expect(r.status).toBe(401);
    expect(status()).toBe("open");
  });

  it("400 for a signed body that is not a JSON object", async () => {
    expect((await deliver(server.url, null, { raw: "not json" })).status).toBe(400);
    expect((await deliver(server.url, null, { raw: "[1]" })).status).toBe(400);
  });

  it("dedupes a retried delivery id and the same body under a new id", async () => {
    const body = confirmed();
    await deliver(server.url, body, { deliveryId: "d1" });
    expect(await (await deliver(server.url, { event: "draft.seen", data: {} }, { deliveryId: "d1" })).json()).toEqual({ ok: true, duplicate: true });
    expect(await (await deliver(server.url, body, { deliveryId: "d2" })).json()).toEqual({ ok: true, duplicate: true });
    expect((await (await fetch(`${server.url}/api/wall`)).json()).coffees).toBe(3);
  });

  it("dedupe survives a restart", async () => {
    await deliver(server.url, { event: "draft.seen", data: { orderId: `coffee-${NONCE}` } }, { deliveryId: "keep" });
    await server.close();
    await start();
    expect(await (await deliver(server.url, confirmed(), { deliveryId: "keep" })).json()).toEqual({ ok: true, duplicate: true });
    expect(status()).toBe("seen");
  });

  it("500 and forgotten when the write fails, so send21 retries", async () => {
    const spy = vi.spyOn(store as unknown as { persist: () => void }, "persist").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect((await deliver(server.url, confirmed(), { deliveryId: "retry" })).status).toBe(500);
    expect(status()).toBe("open");
    spy.mockRestore();
    expect(await (await deliver(server.url, confirmed(), { deliveryId: "retry" })).json()).toMatchObject({ outcome: "paid" });
  });

  it("a wrong amount never reaches the wall", async () => {
    expect(await (await deliver(server.url, confirmed({ fiatAmount: 3 }))).json()).toMatchObject({ outcome: "flagged" });
    expect((await (await fetch(`${server.url}/api/wall`)).json()).coffees).toBe(0);
  });
});

describe("pages and API", () => {
  const post = (body: Record<string, string>) =>
    fetch(`${server.url}/coffee`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const nonce = "zyxwvutsrq9876543210";

  it("POST /coffee redirects 303 to the pay link, once per nonce", async () => {
    const a = await post({ nonce, cups: "5", message: "legend" });
    expect(a.status).toBe(303);
    expect(a.headers.get("location")).toMatch(/^http:\/\/localhost\/mock\/pay\//);
    const b = await post({ nonce, cups: "5", message: "legend" });
    expect(b.headers.get("location")).toBe(a.headers.get("location"));
    expect(mock.requests.size).toBe(1);
    expect([...mock.requests.values()][0]!.body).toMatchObject({ fiatAmount: 15, fiatCurrency: "EUR", orderId: `coffee-${nonce}` });
    expect((await post({ nonce, cups: "1" })).status).toBe(409);
  });

  it("400 with a friendly page for bad input", async () => {
    const r = await post({ nonce, cups: "2" });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("pick 1, 3 or 5");
    expect((await post({ nonce, cups: "1", message: "<img src=x onerror=alert(1)>" })).status).toBe(400);
  });

  it("serves the coffee page with safe headers, escaped config, Lightning first", async () => {
    const r = await fetch(server.url);
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-powered-by")).toBeNull();
    const html = await r.text();
    expect(html).toContain("⚡ Lightning first");
    expect(html).toContain("3.00 EUR");
    expect(html).toMatch(/name="nonce" value="[a-z0-9]{20}"/);
  });

  it("serves the badge, the widget and the wall API cross-origin", async () => {
    const badge = await fetch(`${server.url}/badge.svg`);
    expect(badge.headers.get("content-type")).toMatch(/image\/svg\+xml/);
    expect(await badge.text()).toContain("buy me a coffee");
    await deliver(server.url, confirmed());
    expect(await (await fetch(`${server.url}/badge.svg?count`)).text()).toContain("☕ 3 coffees");
    const widget = await fetch(`${server.url}/widget.js`);
    expect(widget.status).toBe(200);
    expect(widget.headers.get("access-control-allow-origin")).toBe("*");
    expect(widget.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    const js = await widget.text();
    expect(js).toContain("attachShadow");
    expect(js).not.toContain("innerHTML");
    expect((await fetch(`${server.url}/api/wall`)).headers.get("access-control-allow-origin")).toBe("*");
  });

  it("hides amounts unless the owner opts in", async () => {
    await deliver(server.url, confirmed());
    expect((await (await fetch(`${server.url}/api/wall`)).json()).entries[0].amount).toBeNull();
    await server.close();
    await start({ amounts: true, messages: false });
    expect((await (await fetch(`${server.url}/api/wall`)).json()).entries[0]).toMatchObject({ amount: "9.00 EUR", message: null });
  });

  it("rate-limits pay link creation", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post({ nonce: "", cups: "1" })).status);
    expect(codes).toContain(429);
  });
});
