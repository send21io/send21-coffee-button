import { randomInt } from "node:crypto";
import { coinFor, formatFiat } from "./currencies.js";
import { priceFor, type Wall } from "./coffee.js";
import type { WallTx } from "./explorer.js";
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

export function coffeePage(cfg: PageConfig, { error, cups = 3, message = "" }: { error?: string; cups?: number; message?: string } = {}): string {
  const lightning = cfg.options.some((o) => o.method === "Lightning");
  const tiles = CUPS.map(
    (n) => `<label class="tile"><input type="radio" name="cups" value="${n}"${n === cups ? " checked" : ""}>
<span class="cups">${"☕".repeat(n === 1 ? 1 : n === 3 ? 2 : 3)}</span><span class="x">×${n}</span><span class="p">${esc(formatFiat(priceFor(n, cfg.price, cfg.currency), cfg.currency))}</span></label>`,
  ).join("");
  return shell(
    `☕ ${cfg.creator}`,
    `<main class="coffee">
${cfg.mock ? '<p class="mock">🧪 mock</p>' : ""}
<div class="mug" aria-hidden="true">☕</div>
<p class="kicker">buy a coffee for</p>
<h1>${esc(cfg.creator)}</h1>
${lightning ? '<p class="hero">⚡ Lightning first · any wallet</p>' : '<p class="hero">💸 pay from any wallet</p>'}
${error ? `<p class="err" role="alert" id="err">${esc(error)}</p>` : ""}
<form method="post" action="/coffee">
<input type="hidden" name="nonce" value="${newNonce()}">
<fieldset class="tiles"><legend class="sr">how many coffees</legend>${tiles}</fieldset>
<input class="msg" name="message" maxlength="80" placeholder="say hi 👋 (optional)" autocomplete="off" aria-label="message" value="${esc(message)}"${error ? ' aria-invalid="true" aria-describedby="err"' : ""}>
<button class="go">${lightning ? "⚡" : "💸"} pay</button>
</form>
<p class="coins">${esc(coinsLine(cfg.options))}</p>
<p class="foot">🔒 no account · straight to the creator's wallet · <a href="/wall">🎉 wall</a> · <span>send21</span></p>
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

// External links: new tab, no opener, no referrer, no SEO credit.
const ext = (url: string, inner: string, cls = "") => `<a${cls ? ` class="${cls}"` : ""} href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`;
const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id);
export const VERIFY_DOCS = "https://github.com/send21io/send21-coffee-button#verify-the-wall-yourself";

/** One line under a wall note: the explorer link, or why there is none. */
export function txLine(tx: WallTx): string {
  if (tx.chain === "lightning") return `<span class="tx dim">⚡ ${esc(tx.label)}</span>`;
  const id = tx.id ? ` · <code title="${esc(tx.id)}">${esc(shortId(tx.id))}</code>` : "";
  if (tx.url) return ext(tx.url, `🔎 ${esc(tx.label)}${id}`, "tx");
  return `<span class="tx dim">${esc(tx.label)}${id || " · no public link"}</span>`;
}

function verifySection(v: NonNullable<Wall["verify"]>, mock: boolean): string {
  const addrs = v.addresses
    .map((a) => `<li><span class="lbl">${esc(a.label)}</span>${a.url ? ext(a.url, `<code>${esc(a.address)}</code>`) : `<code>${esc(a.address)}</code>`}</li>`)
    .join("");
  return `<section class="verify" aria-labelledby="verify-h"><h2 id="verify-h">🔎 verify it yourself</h2>
<p>On-chain coffees link to a public block explorer: check the amount, the time and that it went to ${v.addresses.length === 1 ? "this address" : "one of these addresses"}.</p>
${addrs ? `<ul class="addrs">${addrs}</ul>` : ""}
<p class="dim">⚡ Lightning payments are not on a public chain, so they can't be checked here. Hidden notes still count in the totals.</p>
${mock ? '<p class="mock">🧪 mock txIds are fake: explorers will say not found</p>' : ""}
<p class="dim"><a href="/api/wall">JSON</a> · ${ext(VERIFY_DOCS, "how to check")}</p>
</section>`;
}

export function wallPage(creator: string, w: Wall, mock: boolean, now = Date.now()): string {
  const items = w.entries.length
    ? w.entries
        .map(
          (e) =>
            `<li class="note"><span class="cups">☕×${e.cups}</span>${e.message ? `<span class="m">${esc(e.message)}</span>` : '<span class="m dim">💛</span>'}<span class="meta">${e.amount ? `${esc(e.amount)} · ` : ""}${ago(e.at, now)}</span>${e.tx ? txLine(e.tx) : ""}</li>`,
        )
        .join("")
    : '<li class="empty">🫙 be the first</li>';
  return shell(
    `🎉 ${creator}`,
    `<main class="wall">
${mock ? '<p class="mock">🧪 mock</p>' : ""}
<p class="big">🎉</p>
<h1>${esc(creator)}</h1>
<p class="stats"><b>☕ ${w.coffees}</b> ${w.coffees === 1 ? "coffee" : "coffees"} · <b>💛 ${w.supporters}</b> ${w.supporters === 1 ? "supporter" : "supporters"}</p>
<a class="go" href="/">☕ buy one</a>
<ul class="notes">${items}</ul>
${w.verify ? verifySection(w.verify, mock) : ""}
<p class="foot">confirmed payments only · <span>send21</span></p>
</main>`,
  );
}

export const errorPage = (text: string) => shell("☕", `<main class="coffee"><p class="big">😵</p><p class="err">${esc(text)}</p><a class="go" href="/">↩️ back</a></main>`);
