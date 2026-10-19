import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response } from "express";
import { badgeSvg } from "./badge.js";
import { applyEvent, checkInput, createOrder, wall, type CoffeeConfig } from "./coffee.js";
import { formatFiat } from "./currencies.js";
import { coffeePage, errorPage, esc, wallPage } from "./pages.js";
import { friendlyError, Send21Error, type createMockClient, type Send21Client } from "./send21.js";
import { Store } from "./store.js";
import { signV2, verifySignatureV2 } from "./verify.js";

export interface AppDeps {
  store: Store;
  send21: Send21Client;
  secret: string;
  coffee: CoffeeConfig;
  wall: { amounts: boolean; messages: boolean };
  publicUrl: string;
  log?: (line: string) => void;
  /** Mock mode only: /mock/pay/<token> simulates payments, /demo is a sample host page. */
  mock?: { client: ReturnType<typeof createMockClient>; selfUrl: string };
  trustProxy?: boolean;
}

// public/ sits next to src/ (tsx) or two levels up from dist/src/ (built).
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, HERE.includes(`${sep}dist${sep}`) ? "../../public" : "../public");

/** Token bucket per IP: `burst` requests, refilled at one per `everyMs`. */
export function rateLimit(burst: number, everyMs: number) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (req: Request, res: Response, next: () => void) => {
    const key = req.ip ?? "?";
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + (now - b.at) / everyMs);
    b.at = now;
    if (b.tokens < 1) {
      res.set("Retry-After", String(Math.ceil(everyMs / 1000))).status(429).type("html").send(errorPage("🐢 slow down, try again in a minute"));
      return;
    }
    b.tokens -= 1;
    buckets.set(key, b);
    if (buckets.size > 10_000) buckets.clear();
    next();
  };
}

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self' https://send21.io; frame-ancestors 'none'";

export function createApp(deps: AppDeps): Express {
  const { store, send21, secret, coffee, log = console.log, mock, trustProxy = false } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use((_req, res, next) => {
    res.set({ "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    next();
  });
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, mode: send21.mode });
  });

  // ---------- send21 webhook: raw bytes, the signature covers the exact body ----------
  app.post("/webhooks/send21", express.raw({ type: () => true, limit: "64kb" }), (req, res) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const deliveryId = req.get("x-send21-delivery");
    // 1. Signature V2 + 300 s window. Nothing is stored for a request that fails.
    if (!verifySignatureV2(raw, req.get("x-send21-signature-v2"), deliveryId, secret)) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }
    let body: { event?: unknown; data?: unknown };
    try {
      body = JSON.parse(raw.toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    } catch {
      res.status(400).json({ error: "invalid json" });
      return;
    }
    // 2 + 3. Dedupe and apply in one write: either both are on disk or neither.
    const eventKey = createHash("sha256").update(raw).digest("hex");
    let applied;
    try {
      applied = store.transaction((d) => (Store.remember(d, deliveryId as string, eventKey) ? applyEvent(d, body) : null));
    } catch (err) {
      log(`webhook: store write failed, send21 will retry: ${(err as Error).message}`);
      res.status(500).json({ error: "try again" });
      return;
    }
    if (applied === null) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    log(`webhook ${String(body.event)} ${deliveryId}: ${applied.outcome}`);
    res.status(200).json({ ok: true, outcome: applied.outcome });
  });

  // ---------- the coffee page and the pay redirect ----------
  const page = { creator: coffee.creator, price: coffee.price, currency: coffee.currency, options: coffee.options, mock: send21.mode === "mock" };
  app.get("/", (req, res) => {
    res.set("Cache-Control", "no-store").type("html").send(coffeePage(page, { cups: Number(req.query.cups) || 3 }));
  });
  app.post("/coffee", rateLimit(10, 60_000), express.urlencoded({ extended: false, limit: "2kb" }), async (req, res) => {
    const input = checkInput(req.body ?? {});
    if (!input.ok) {
      res.status(400).type("html").send(coffeePage(page, { error: input.error }));
      return;
    }
    try {
      const order = await createOrder(store, send21, coffee, input);
      res.redirect(303, order.payUrl!);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409 && !(err instanceof Send21Error)) {
        res.status(409).type("html").send(coffeePage(page, { error: "🔁 that form was already used. Try again." }));
        return;
      }
      log(`pay link failed: ${(err as Error).message}`);
      res.status(502).type("html").send(errorPage(friendlyError(err)));
    }
  });

  // ---------- supporters wall, badge, widget ----------
  const wallData = () => wall(store.orders(), deps.wall);
  app.get("/wall", (_req, res) => {
    res.set("Cache-Control", "no-store").type("html").send(wallPage(coffee.creator, wallData(), send21.mode === "mock"));
  });
  app.get("/api/wall", (_req, res) => {
    // Public data by design, readable by the widget on any site.
    res.set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" }).json(wallData());
  });
  app.get("/badge.svg", (req, res) => {
    const left = req.query.count !== undefined ? `☕ ${wallData().coffees} coffees` : "☕ buy me a coffee";
    res.set({ "Cache-Control": "public, max-age=300", "Cross-Origin-Resource-Policy": "cross-origin", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" }).type("image/svg+xml").send(badgeSvg(left));
  });
  // The widget loads on other sites: allow it cross-origin.
  app.get("/widget.js", (_req, res, next) => {
    res.set({ "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin", "Cache-Control": "public, max-age=300" });
    next();
  });

  if (mock) {
    mountMock(app, secret, mock);
    app.get("/demo", (_req, res) => {
      res.sendFile(resolve(PUBLIC_DIR, "demo.html"));
    });
  }
  app.use(express.static(PUBLIC_DIR, { index: false }));
  return app;
}

// ---------- mock mode: a tiny local "pay page" that sends signed deliveries ----------

function mountMock(app: Express, secret: string, { client, selfUrl }: NonNullable<AppDeps["mock"]>): void {
  app.get("/mock/pay/:token", (req, res) => {
    const entry = client.requests.get(req.params.token);
    if (!entry) {
      res.status(404).send("unknown pay link");
      return;
    }
    const t = esc(req.params.token);
    const coins = entry.body.options.map((o, i) => `<option value="${i}">${esc(`${o.currency.toUpperCase()} · ${o.method ?? o.network}`)}</option>`).join("");
    res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>mock pay</title><link rel="stylesheet" href="/coffee.css">
<main class="coffee"><p class="mock">🧪 mock · no real money</p><p class="big">${esc(formatFiat(entry.body.fiatAmount, entry.body.fiatCurrency))}</p><p>${esc(entry.body.memo)}</p>
${[["seen", "👀 start paying"], ["paid", "✅ pay"], ["short", "⚠️ pay 5% short"], ["expire", "⌛ expire"]].map(([a, l]) => `<form class="mockrow" method="post" action="/mock/pay/${t}/${a}"><select name="coin">${coins}</select><button class="go">${l}</button></form>`).join("")}
</main>`);
  });

  app.post("/mock/pay/:token/:action", express.urlencoded({ extended: false, limit: "1kb" }), async (req, res) => {
    const entry = client.requests.get(req.params.token);
    if (!entry) {
      res.status(404).send("unknown pay link");
      return;
    }
    const option = entry.body.options[Number((req.body as { coin?: string })?.coin ?? 0)] ?? entry.body.options[0]!;
    const units = option.currency === "Btc" ? 1e8 : option.currency === "Sol" || option.currency === "Eth" ? 1e9 : 1e6;
    const price = option.currency === "Btc" ? 60000 : option.currency === "Eth" ? 3000 : option.currency === "Sol" ? 150 : 1;
    const amountSats = Math.max(1, Math.round((entry.body.fiatAmount / price) * units));
    const base = {
      draftId: randomUUID(),
      paymentRequestId: entry.response.id,
      orderId: entry.body.orderId,
      sentCurrency: option.currency.toUpperCase(),
      network: option.network,
      fiatCurrency: entry.body.fiatCurrency,
      fiatAmount: entry.body.fiatAmount,
      amountSats,
      sentAmount: (amountSats / units).toFixed(Math.log10(units)),
      occurredAt: new Date().toISOString(),
    };
    const action = req.params.action;
    const body =
      action === "paid"
        ? { event: "draft.confirmed", data: { ...base, status: "Confirmed", txId: `mock-${randomUUID()}`, confirmations: 1 } }
        : action === "seen"
          ? { event: "draft.seen", data: { ...base, status: "Seen", txId: `mock-${randomUUID()}`, confirmations: 0 } }
          : action === "short"
            ? { event: "draft.amount_mismatch", data: { ...base, status: "AwaitingPayment", reviewState: "pending", receivedAmountSats: Math.round(amountSats * 0.95) } }
            : { event: "payment_request.expired", data: { paymentRequestId: entry.response.id, orderId: entry.body.orderId, opened: true, quoteRequested: false } };
    const raw = JSON.stringify(body);
    const deliveryId = randomUUID();
    const r = await fetch(`${selfUrl}/webhooks/send21`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-send21-event": body.event, "x-send21-delivery": deliveryId, "x-send21-signature-v2": signV2(raw, deliveryId, Math.floor(Date.now() / 1000), secret) },
      body: raw,
    });
    res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/coffee.css">
<main class="coffee"><p class="big">${r.ok ? "📨" : "❌"}</p><p>${esc(r.ok ? body.event : String(r.status))}</p><a class="go" href="/wall">🎉 wall</a><p class="foot"><a href="/mock/pay/${esc(req.params.token)}">↩️ back</a></p></main>`);
  });
}
