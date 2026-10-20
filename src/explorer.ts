// Public block-explorer links, so anyone can check a wall entry without
// trusting this server (or send21). Values are the ones the app stores:
// paid.currency is the webhook's sentCurrency ("USDC"), paid.network the
// API network ("Solana", "Ethereum", "Mainnet"), and Lightning is the
// `method: "Lightning"` pay-link option on Bitcoin `Mainnet`.
//
// Only mainnet explorers are linked. send21 account drafts (and so this app)
// use the live networks; test networks exist only in the send21 demo, so a
// network value the app does not know gets no link.

import { checkAddress, coinFor, type Coin } from "./currencies.js";
import type { PayOption } from "./types.js";

export type Chain = "solana" | "ethereum" | "bitcoin";

const TX_URL: Record<Chain, (id: string) => string> = {
  solana: (id) => `https://solscan.io/tx/${encodeURIComponent(id)}`,
  ethereum: (id) => `https://etherscan.io/tx/${encodeURIComponent(id)}`,
  bitcoin: (id) => `https://mempool.space/tx/${encodeURIComponent(id)}`,
};
const ADDRESS_URL: Record<Chain, (a: string) => string> = {
  solana: (a) => `https://solscan.io/account/${encodeURIComponent(a)}`,
  ethereum: (a) => `https://etherscan.io/address/${encodeURIComponent(a)}`,
  bitcoin: (a) => `https://mempool.space/address/${encodeURIComponent(a)}`,
};

// Transaction id shapes. Solana: a base58 signature (64 bytes, 64-88 chars).
// Ethereum (and other EVM chains): 0x + 32-byte hex. Bitcoin: 32-byte hex.
const SOLANA_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const BTC_TX = /^[0-9a-fA-F]{64}$/;

/** The explorer chain for a coin: SOL/USDC/USDT/EURC on Solana, ETH/USDC/USDT/EURC on Ethereum, on-chain BTC. */
export function chainOf(coin: Coin | undefined): Chain | null {
  if (!coin || coin.method === "Lightning") return null;
  if (coin.network === "Solana" && ["Sol", "Usdc", "Usdt", "Eurc"].includes(coin.currency)) return "solana";
  if (coin.network === "Ethereum" && ["Eth", "Usdc", "Usdt", "Eurc"].includes(coin.currency)) return "ethereum";
  if (coin.network === "Mainnet" && coin.currency === "Btc") return "bitcoin";
  return null;
}

/** A well-formed txId for that chain, normalised (lowercase hex), or null. */
export function cleanTxId(kind: Coin["kind"], txId: unknown): string | null {
  if (typeof txId !== "string") return null;
  const id = txId.trim();
  if (kind === "solana") return SOLANA_SIG.test(id) ? id : null;
  if (kind === "evm") return EVM_TX.test(id) ? id.toLowerCase() : null;
  if (kind === "bitcoin") return BTC_TX.test(id) ? id.toLowerCase() : null;
  return null;
}

/** Explorer link for a transaction, only for a public chain and a valid txId. */
export function txUrl(coin: Coin | undefined, txId: unknown): string | null {
  const chain = chainOf(coin);
  const id = coin && chain ? cleanTxId(coin.kind, txId) : null;
  return chain && id ? TX_URL[chain](id) : null;
}

/** Explorer link for a receiving address, only for a public chain and a valid address. */
export function addressUrl(coin: Coin | undefined, address: string): string | null {
  const chain = chainOf(coin);
  if (!coin || !chain) return null;
  const a = checkAddress(coin, address);
  return a.ok && a.address === address ? ADDRESS_URL[chain](address) : null;
}

export interface WallTx {
  /** "solana" | "ethereum" | "bitcoin" when linked, "lightning", or null (another chain, or unknown). */
  chain: Chain | "lightning" | null;
  /** "USDC · Solana", "Lightning (not public)", ... */
  label: string;
  /** The on-chain transaction id. Null for Lightning and when it is not well-formed. */
  id: string | null;
  /** Block explorer link, or null. */
  url: string | null;
  /** The receiving address this order offered for that coin (on-chain only). */
  to: string | null;
}

export const LIGHTNING_LABEL = "Lightning (not public)";

/**
 * Which coin paid an order. The webhook carries sentCurrency + network but no
 * payment method, and BTC over Lightning and on-chain BTC are both
 * `Btc`/`Mainnet`. The order's own options decide: if it offered only one of
 * the two, that is the one. If it offered both, it stays unknown (no link).
 */
export function paidCoin(paid: { currency: string; network: string; method?: string | null }, options: PayOption[]): Coin | "ambiguous" | undefined {
  const onchain = coinFor(paid.currency, paid.network);
  const lightning = coinFor(paid.currency, paid.network, "Lightning");
  if (!lightning) return onchain;
  if (paid.method) return String(paid.method).toLowerCase() === "lightning" ? lightning : onchain;
  const offered = (c: Coin | undefined) => !!c && options.some((o) => o.currency === c.currency && o.network === c.network && (o.method ?? null) === (c.method ?? null));
  const ln = offered(lightning);
  const oc = offered(onchain);
  if (ln && !oc) return lightning;
  if (oc && !ln) return onchain;
  return "ambiguous";
}

/** The public, checkable part of one paid order. */
export function wallTx(paid: { currency: string; network: string; txId: string; method?: string | null }, options: PayOption[]): WallTx {
  const coin = paidCoin(paid, options);
  if (coin === "ambiguous") {
    // Could be a Lightning payment hash or an on-chain txid: never link a guess.
    return { chain: null, label: "BTC (on-chain or Lightning)", id: cleanTxId("bitcoin", paid.txId), url: null, to: null };
  }
  if (coin?.method === "Lightning") return { chain: "lightning", label: LIGHTNING_LABEL, id: null, url: null, to: null };
  const option = coin && options.find((o) => o.currency === coin.currency && o.network === coin.network && !o.method);
  const label = coin ? coin.label : `${String(paid.currency).toUpperCase()} · ${paid.network}`;
  const id = coin ? cleanTxId(coin.kind, paid.txId) : null;
  const url = txUrl(coin, paid.txId);
  return { chain: url ? chainOf(coin) : null, label, id, url, to: option?.address ?? null };
}

export interface WallAddress {
  label: string;
  address: string;
  url: string | null;
}

/** The on-chain receiving addresses to publish on the wall (Lightning addresses are not on a public chain). */
export function receivingAddresses(options: PayOption[]): WallAddress[] {
  const out: WallAddress[] = [];
  for (const o of options) {
    if (o.method === "Lightning") continue;
    const coin = coinFor(o.currency, o.network);
    if (!coin || out.some((a) => a.address === o.address && a.label === coin.label)) continue;
    out.push({ label: coin.label, address: o.address, url: addressUrl(coin, o.address) });
  }
  return out;
}
