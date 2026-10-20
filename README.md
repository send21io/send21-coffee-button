# send21 coffee button ☕

**A "buy me a coffee" for creators and maintainers. Lightning first, crypto ok, self-hosted, one script tag.** Built on [send21](https://send21.io), crypto pay links and API for people and AI agents.

<p>
  <img src="docs/widget-mock.png" alt="Floating coffee button and popup on a sample project page" width="240">
  <img src="docs/coffee-page-mock.png" alt="Coffee page: x1, x3, x5 and a message" width="240">
  <img src="docs/wall-mock.png" alt="Supporters wall with coffee count, notes, explorer links and the verify box" width="240">
</p>
<p><img src="docs/badge-mock.png" alt="README badge: buy me a coffee | send21" width="620"></p>

<sub>Mock-mode screenshots, not real payments.</sub>

- ⚡ Fans tap ☕ ×1, ×3 or ×5, say hi, and pay over **BTC Lightning**, or USDC, USDT, EURC, SOL, ETH, on-chain BTC, whichever you add
- 🔒 Non-custodial: the money goes from the fan's wallet straight to yours
- 🎉 A public supporters wall, filled only by verified, confirmed payments
- 🔎 Independently verifiable: every on-chain coffee links to its transaction on a public block explorer ([verify the wall yourself](#verify-the-wall-yourself))

## Quickstart

1. **Try it now, no key:** `npm install && npm run dev`, then open http://localhost:3000/demo. Mock mode: tap ☕, pay on the mock page with ✅ (or try ⚠️ short → 👍 accept / ↩️ decline, ⌛ expire) and watch the 🎉 wall.
2. **send21 key.** On [send21.io/api-keys](https://send21.io/api-keys), create a key with `drafts:write` (add `webhooks:manage` for step 4).
3. **Configure.** `cp .env.example .env`: your key, `PUBLIC_URL`, `CREATOR_NAME`, `COFFEE_PRICE` + `COFFEE_CURRENCY` (say 3 EUR) and your receiving addresses: `PAY_LIGHTNING=you@your-wallet.com` and optional extras like `PAY_OPTIONS=usdc-sol:<address>`.
   - 🔐 **Approve your receiving addresses in send21.** New send21 accounts (created on or after 20 Oct 2026) only accept receiving addresses the owner approved, including Lightning addresses. Add them in the send21 app, or propose one from an agent (MCP `propose_receiving_address`), then sign in and approve it with a passkey or authenticator code. No API key can approve an address. Older accounts can opt in under Settings.
4. **Webhook.** Put the app behind your own HTTPS address (for example a reverse proxy with a free Let's Encrypt certificate, and `TRUST_PROXY=1`), then run `npm run webhook:register` and paste the printed `SEND21_WEBHOOK_SECRET` into `.env`.
5. **Run and embed.** `npm run build && npm start`, then paste a snippet below.

## Embed

**Floating button + popup** (any website, one line):

```html
<script src="https://coffee.example.com/widget.js" async></script>
```

Options: `data-position="left"`, `data-label="☕"`. It lives in a shadow root, so your CSS and its CSS never collide. Open it from your own button with `send21Coffee.open()`. If your site has a strict CSP, allow the origin in `script-src`, `connect-src` and `form-action`.

**README badge** (links to your coffee page):

```markdown
[![☕ buy me a coffee](https://coffee.example.com/badge.svg)](https://coffee.example.com/)
```

Live counter variant: `https://coffee.example.com/badge.svg?count` → `☕ 13 coffees | send21`. Wall: `https://coffee.example.com/wall`, JSON: `/api/wall` (shape in [Verify the wall yourself](#verify-the-wall-yourself)).

## How it works

A fan picks a size and an optional message (plain text, 80 characters, no links). The coffee page or the widget posts it to your server with a random 20-character nonce. Your server creates one send21 **payment request**: a pay link priced in fiat (cups × `COFFEE_PRICE`), offering your Lightning address first and your other coins after, with `orderId` `coffee-<nonce>` sent as the Idempotency-Key too. A double tap returns the same link, never a second one. The fan is redirected (303) to the send21 pay page, picks a coin (the rate locks for 15 minutes) and pays from their own wallet. The message stays on your server; send21 only sees `☕ ×3 for <creator>`.

```mermaid
sequenceDiagram
    participant F as Fan
    participant C as Coffee server (yours)
    participant S as send21
    participant W as Your wallet
    F->>C: ☕ ×3 + "keep going!" (widget or page)
    C->>S: POST /api/v1/payment-requests<br/>9 EUR, ⚡ Lightning + coins,<br/>orderId coffee-<nonce>, Idempotency-Key
    S-->>C: id, payPath
    C-->>F: 303 → send21 pay page
    F->>W: pays ⚡ straight to your wallet
    S->>C: POST /webhooks/send21 draft.confirmed (signed V2)
    Note over C: verify HMAC + 300 s window,<br/>dedupe, check orderId, pay link,<br/>amount, currency and coin
    C-->>F: 🎉 on the supporters wall
```

| Webhook | Order | On the wall? |
| --- | --- | --- |
| `draft.seen` | 👀 seen | no |
| `draft.confirmed`, matches the order | ✅ paid | **yes** |
| `draft.confirmed`, does **not** match | 🚩 flagged | never |
| `draft.amount_mismatch` → `mismatch_accepted` / `rejected` / `unresolved` | ⚠️ review → 👍 / ↩️ / ⚠️ | only after a matching `draft.confirmed` |
| `payment_request.expired`, `draft.expired` | ⌛ expired (a late confirmed payment still counts) | no |

Payments up to `COFFEE_SHORTFALL_PERCENT` (default 2%) short are accepted through send21's `shortfallPolicy`; other different amounts wait for you to accept or decline them on send21. Hide a note with `npm run wall:hide -- <order id>` (it still counts); hide all amounts or messages with `WALL_SHOW_AMOUNTS` / `WALL_SHOW_MESSAGES`. Amounts are hidden by default. Transaction ids, explorer links and your receiving addresses are shown by default; turn them off with `WALL_SHOW_TX=false`.

**⚡ Lightning.** send21 fetches a fresh invoice from your Lightning address for the exact amount and confirms the payment when your wallet provider supports **LUD-21**. Use a provider with LUD-21: without it, the fan's payment still reaches you, but send21 cannot confirm it on its own, so it won't reach the wall. See [Lightning](https://send21.io/docs/lightning).

**Fees.** One small send21 fee per paid coffee (0.49% on small payments, at least $0.01), never taken from the payment. See [pricing](https://send21.io/pricing).

## Verify the wall yourself

You don't have to trust this server (or send21) for the totals. With `WALL_SHOW_TX=true` (the default), every on-chain entry on `/wall` links to its transaction on a public block explorer, and a **🔎 verify it yourself** box lists the on-chain addresses the listed payments went to, each linked to the explorer too.

| Paid with (stored `currency` · `network`) | Explorer |
| --- | --- |
| SOL, USDC, USDT, EURC · `Solana` | `https://solscan.io/tx/<txId>` |
| ETH, USDC, USDT, EURC · `Ethereum` | `https://etherscan.io/tx/<txId>` |
| BTC on-chain · `Mainnet` | `https://mempool.space/tx/<txId>` |
| BTC over Lightning (`method: "Lightning"`) | no link: shown as "Lightning (not public)" |
| any other network | label and txId, no link |

To check:

1. Open `/wall` (or `/api/wall`) and click a 🔎 transaction.
2. On the explorer, check the **amount** (the crypto amount for the coffee's fiat price at the time), the **time**, and that the **receiving address** is one listed under 🔎 verify it yourself.
3. Open each receiving address on the explorer to see its incoming payments, and **sum the on-chain entries**: each listed on-chain coffee should match exactly one incoming transaction. The wall's ☕ and 💛 totals also count Lightning payments and notes the owner hid, so they can be higher than what you can count on-chain. The page and the API list the latest 100 entries.

`/api/wall` returns the same data as JSON (public, CORS `*`):

```json
{
  "coffees": 4, "supporters": 2,
  "entries": [
    { "cups": 3, "message": "keep going!", "amount": null, "at": "2026-10-19T10:05:00.000Z",
      "tx": { "chain": "solana", "label": "USDC · Solana", "id": "5VERv8NM…", "url": "https://solscan.io/tx/5VERv8NM…", "to": "7xKXtg2C…" } },
    { "cups": 1, "message": null, "amount": null, "at": "2026-10-18T09:00:00.000Z",
      "tx": { "chain": "lightning", "label": "Lightning (not public)", "id": null, "url": null, "to": null } }
  ],
  "verify": { "addresses": [ { "label": "USDC · Solana", "address": "7xKXtg2C…", "url": "https://solscan.io/account/7xKXtg2C…" } ] },
  "prices": { "1": "3.00 EUR", "3": "9.00 EUR", "5": "15.00 EUR" }
}
```

How the link is built: the txId comes from the signed `draft.confirmed` webhook and is checked for shape first (base58 signature on Solana, `0x` + 64 hex on Ethereum, 64 hex for Bitcoin). A txId in any other shape gets no id and no link. send21 account payments use the live networks, so only mainnet explorers are linked. The webhook says `BTC` · `Mainnet` for both on-chain and Lightning: the app uses the coin the order offered, and if an order offered both on-chain BTC and Lightning, that entry shows its id but no link rather than a guess. Links open in a new tab with `rel="noopener noreferrer nofollow"`.

Caveats:

- **The sender is public too.** An explorer shows the address a payment came from, and that address's other activity. A fan who wants privacy should pay over Lightning, or from a fresh address. Turn the whole thing off with `WALL_SHOW_TX=false`.
- **Lightning isn't publicly verifiable.** A Lightning payment leaves no public record, so those entries say "Lightning (not public)" and have no txId.
- The wall cannot prove what it leaves out: a payment to your address that never came through a coffee pay link is on the explorer but not on the wall.

**Mock mode:** mock payments get txIds in the right shape so the links render, but they are obviously fake (hex ids start with 16 zeros, Solana ids with `MockTxFake`) and the explorer will say not found. The mock wall says so.

## Troubleshooting

- **422 `address_not_approved`:** a receiving address isn't approved in your send21 account, so nothing was created. Sign in to send21, approve the address (passkey or authenticator code), then try again.

## Security notes

- **Signature V2 only.** Every delivery is checked with `X-Send21-Signature-V2`: HMAC-SHA256 over `<t>.<delivery id>.<raw body>`, constant-time compare, refused when more than **300 s** old or in the future. A bad signature gets `401` and nothing is stored.
- **The receiver dedupes deliveries.** send21 does not dedupe deliveries. Retries reuse the same `X-Send21-Delivery` id, and the receiver ignores deliveries it already handled: a delivery id, or the same event body under a new id, is applied once. Separately, one pay link is one payment. The delivery id and the wall update are written together before the `2xx`, so a restart cannot apply it twice. A failed write answers `500` so send21 retries.
- **Checked against the stored order.** A `draft.confirmed` must match that order exactly: `orderId`, pay link id, fiat currency, the exact amount for its cups (integer cents), a coin and network you offered, a txId and `status: Confirmed`. Anything else is 🚩 and never shows up. Paid is final; late or out-of-order events never undo it. Other apps' orders on the same send21 account are ignored.
- **Wall = confirmed payments only.** Notes are plain text: no links, no markup, no hidden or bidi characters, max 80, escaped on output. Amounts are off by default.
- **Hardened server.** Strict CSP (`'self'` only, no inline script or style) and `frame-ancestors 'none'` on every page, no `innerHTML` in the widget, tiny body limits, pay link creation rate-limited per IP (429 + Retry-After). The widget, badge and `/api/wall` are public by design and served cross-origin; everything else is same-origin. The API key stays on the server and is never logged; a send21 key cannot move funds anyway.
- **Your addresses only.** Addresses are shape-checked per network; anything that looks like a seed phrase or private key is refused. send21 never asks for one.
- **Data.** One JSON file (`DATA_FILE`, mode 600). For several processes, use SQLite or Postgres.

## Develop

```bash
npm run check   # typecheck + lint + tests (signature, dedupe, order matching, idempotency, wall, explorer links, badge, API)
```

API reference: [send21.io/docs](https://send21.io/docs) · [quickstart](https://send21.io/docs/quickstart) · [webhooks](https://send21.io/docs/webhooks) · [llms-full.txt](https://send21.io/llms-full.txt). More examples: [send21-examples](https://github.com/send21io/send21-examples).

Questions: [info@send21.io](mailto:info@send21.io). License: [MIT](LICENSE).
