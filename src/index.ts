import { loadConfig } from "./config.js";
import { createMockClient, createSend21Client } from "./send21.js";
import { createApp } from "./server.js";
import { Store } from "./store.js";

const cfg = loadConfig();
const store = new Store(cfg.dataFile);
const mockClient = cfg.mock ? createMockClient(cfg.publicUrl) : null;
const send21 = mockClient ?? createSend21Client({ apiBase: cfg.send21ApiBase, apiKey: cfg.send21ApiKey as string });

const app = createApp({
  store,
  send21,
  secret: cfg.webhookSecret,
  coffee: { creator: cfg.creator, price: cfg.price, currency: cfg.currency, options: cfg.options, expiryHours: cfg.expiryHours, shortfallPercent: cfg.shortfallPercent },
  wall: { amounts: cfg.wallAmounts, messages: cfg.wallMessages },
  publicUrl: cfg.publicUrl,
  trustProxy: cfg.trustProxy,
  ...(mockClient ? { mock: { client: mockClient, selfUrl: `http://127.0.0.1:${cfg.port}` } } : {}),
});

app.listen(cfg.port, () => {
  console.log(`☕ coffee page ${cfg.publicUrl}/  ·  🎉 ${cfg.publicUrl}/wall  ·  🪝 /webhooks/send21`);
  if (cfg.mock) console.log(`🧪 MOCK mode: no send21 calls. Sample host page with the widget: ${cfg.publicUrl}/demo`);
});
