import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockClient } from "../src/send21.js";
import { createApp } from "../src/server.js";
import { Store } from "../src/store.js";
import { coffeeConfig, listen, SECRET } from "./helpers.js";

let dir: string;
let server: Awaited<ReturnType<typeof listen>>;
let store: Store;
let mock: { client: ReturnType<typeof createMockClient>; selfUrl: string };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "coffee-mock-"));
  store = new Store(join(dir, "c.json"));
  mock = { client: createMockClient("http://localhost"), selfUrl: "" };
  server = await listen(createApp({ store, send21: mock.client, secret: SECRET, coffee: coffeeConfig(), wall: { amounts: false, messages: true }, publicUrl: "http://localhost", log: () => undefined, mock }));
  mock.selfUrl = server.url;
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: string) => fetch(`${server.url}${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

async function order(message = "hi") {
  const r = await post("/coffee", `nonce=${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}&cups=1&message=${encodeURIComponent(message)}`);
  expect(r.status).toBe(303);
  const token = /\/mock\/pay\/([^/?#]+)/.exec(r.headers.get("location")!)![1]!;
  const act = (a: string) => post(`/mock/pay/${token}/${a}`, "coin=0");
  return { token, act };
}
const wall = async () => (await (await fetch(`${server.url}/api/wall`)).json()) as { coffees: number };

describe("coffee page errors", () => {
  it("a refused message keeps what you typed and your cups", async () => {
    const r = await post("/coffee", "nonce=abcdefghij0123456789&cups=5&message=" + encodeURIComponent("see https://spam.example"));
    expect(r.status).toBe(400);
    const html = await r.text();
    expect(html).toContain('value="see https://spam.example"');
    expect(html).toMatch(/value="5" checked/);
    expect(html).toContain('aria-invalid="true"');
  });
});

describe("wall API", () => {
  it("carries the tile prices, so the widget matches the page", async () => {
    const w = await (await fetch(`${server.url}/api/wall`)).json();
    expect(Object.keys(w.prices)).toEqual(["1", "3", "5"]);
    const page = await (await fetch(`${server.url}/`)).text();
    for (const p of Object.values(w.prices) as string[]) expect(page).toContain(p);
  });
});

describe("mock pay page", () => {
  it("one coin picker, every action, lang set", async () => {
    const { token } = await order();
    const html = await (await fetch(`${server.url}/mock/pay/${token}`)).text();
    expect(html).toContain('<html lang="en">');
    expect(html.match(/<select/g)).toHaveLength(1);
    for (const a of ["paid", "seen", "short", "accept", "decline", "expire"]) expect(html).toContain(`/mock/pay/${token}/${a}`);
  });

  it("short → accept lands on the wall, short → decline does not", async () => {
    const one = await order();
    await one.act("short");
    expect((await wall()).coffees).toBe(0);
    expect((await one.act("accept")).status).toBe(200);
    expect((await wall()).coffees).toBe(1);
    const page = await (await fetch(`${server.url}/wall`)).text();
    expect(page).toContain("☕ 1</b> coffee ·");
    expect(page).toContain("💛 1</b> supporter</p>");
    const two = await order();
    await two.act("short");
    await two.act("decline");
    expect((await wall()).coffees).toBe(1);
  });

  it("an unknown action is a 404, not an expiry", async () => {
    const { act } = await order();
    expect((await act("nope")).status).toBe(404);
    expect(store.orders().map((o) => o.status)).toEqual(["open"]);
  });
});
