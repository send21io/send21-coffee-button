import { randomInt } from "node:crypto";
import { coinFor, formatFiat } from "./currencies.js";
import { priceFor, type wall } from "./coffee.js";
import { CUPS, type PayOption } from "./types.js";

// Server-rendered pages: no JavaScript needed to buy a coffee. Every value
// that came from a user or the config goes through esc().
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function newNonce(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 20 }, () => abc[randomInt(abc.length)]).join("");
}

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#1b1c20"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>
<link rel="icon" href="data:,"><link rel="stylesheet" href="/coffee.css"></head>
<body>${body}</body></html>`;

/** "⚡ BTC · 🔵 USDC · 💎 ETH", Lightning first. */
export function coinsLine(options: PayOption[]): string {
  const seen = new Set<string>();
  return options
    .map((o) => {
      const coin = coinFor(o.currency, o.network, o.method);
      const label = o.method === "Lightning" ? "⚡ Lightning" : `${coin?.emoji ?? "🪙"} ${o.currency.toUpperCase()}`;
      if (seen.has(label)) return null;
      seen.add(label);
      return label;
    })
    .filter(Boolean)
    .join(" · ");
}

export interface PageConfig {
  creator: string;
  price: number;
  currency: string;
  options: PayOption[];
  mock: boolean;
}

export function coffeePage(cfg: PageConfig, { error, cups = 3 }: { error?: string; cups?: number } = {}): string {
  const lightning = cfg.options.some((o) => o.method === "Lightning");
  const tiles = CUPS.map(
    (n) => `<label class="tile"><input type="radio" name="cups" value="${n}"${n === cups ? " checked" : ""}>
<span class="cups">${"☕".repeat(n === 1 ? 1 : n === 3 ? 2 : 3)}</span><span class="x">×${n}</span><span class="p">${esc(formatFiat(priceFor(n, cfg.price, cfg.currency), cfg.currency))}</span></label>`,
  ).join("");
  return shell(
    `☕ ${cfg.creator}`,
    `<main class="coffee">
${cfg.mock ? '<p class="mock">🧪 mock</p>' : ""}
<div class="mug" aria-hidden="true"><span class="steam">♨️</span>☕</div>
<h1>${esc(cfg.creator)}</h1>
${lightning ? '<p class="hero">⚡ Lightning first</p>' : ""}
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<form method="post" action="/coffee">
<input type="hidden" name="nonce" value="${newNonce()}">
<div class="tiles">${tiles}</div>
<input class="msg" name="message" maxlength="80" placeholder="say hi 👋 (optional)" autocomplete="off" aria-label="message">
<button class="go">${lightning ? "⚡" : "💸"} pay</button>
</form>
<p class="coins">${esc(coinsLine(cfg.options))}</p>
<p class="foot"><a href="/wall">🎉 wall</a> · <span>send21</span></p>
</main>`,
  );
}

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export function wallPage(creator: string, w: ReturnType<typeof wall>, mock: boolean, now = Date.now()): string {
  const items = w.entries.length
    ? w.entries
        .map(
          (e) => `<li class="note"><span class="cups">☕×${e.cups}</span>${e.message ? `<span class="m">${esc(e.message)}</span>` : '<span class="m dim">💛</span>'}<span class="meta">${e.amount ? `${esc(e.amount)} · ` : ""}${ago(e.at, now)}</span></li>`,
        )
        .join("")
    : '<li class="empty">🫙 be the first</li>';
  return shell(
    `🎉 ${creator}`,
    `<main class="wall">
${mock ? '<p class="mock">🧪 mock</p>' : ""}
<p class="big">🎉</p>
<h1>${esc(creator)}</h1>
<p class="stats"><b>☕ ${w.coffees}</b> coffees · <b>💛 ${w.supporters}</b> supporters</p>
<a class="go" href="/">☕ buy one</a>
<ul class="notes">${items}</ul>
<p class="foot">confirmed payments only · <span>send21</span></p>
</main>`,
  );
}

export const errorPage = (text: string) => shell("☕", `<main class="coffee"><p class="big">😵</p><p class="err">${esc(text)}</p><a class="go" href="/">↩️ back</a></main>`);
