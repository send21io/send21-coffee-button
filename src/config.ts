import "dotenv/config";
import { randomBytes } from "node:crypto";
import { checkAddress, coinById, isFiat, parseTotal } from "./currencies.js";
import { cleanText } from "./sanitize.js";
import type { PayOption } from "./types.js";

export interface Config {
  send21ApiKey: string | null;
  send21ApiBase: string;
  webhookSecret: string;
  port: number;
  publicUrl: string;
  trustProxy: boolean;
  creator: string;
  price: number;
  currency: string;
  /** Lightning first: the hero option. */
  options: PayOption[];
  expiryHours: number;
  shortfallPercent: number;
  wallAmounts: boolean;
  wallMessages: boolean;
  dataFile: string;
  mock: boolean;
}

const num = (v: string | undefined, def: number, min: number, max: number, name: string): number => {
  const n = v === undefined || v === "" ? def : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
};
const flag = (v: string | undefined, def: boolean) => (v === undefined || v === "" ? def : v === "1" || v.toLowerCase() === "true");

/**
 * PAY_LIGHTNING=name@your-wallet.com and PAY_OPTIONS=usdc-sol:<address>,eth-base:<address>
 * (coin ids from src/currencies.ts). Your own addresses only.
 */
export function parseOptions(lightning: string | undefined, list: string | undefined): PayOption[] {
  const entries: [string, string][] = [];
  if (lightning?.trim()) entries.push(["btc-ln", lightning.trim()]);
  for (const part of (list ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(":");
    if (i < 1) throw new Error(`PAY_OPTIONS: "${part}" should be coin:address`);
    entries.push([part.slice(0, i), part.slice(i + 1)]);
  }
  const options: PayOption[] = [];
  for (const [id, raw] of entries) {
    const coin = coinById(id);
    if (!coin) throw new Error(`PAY_OPTIONS: unknown coin "${id}"`);
    if (options.some((o) => o.currency === coin.currency && o.network === coin.network && o.method === coin.method)) throw new Error(`PAY_OPTIONS: ${id} twice`);
    const address = checkAddress(coin, raw);
    if (!address.ok) throw new Error(`PAY_OPTIONS ${id}: ${address.error}`);
    options.push({ currency: coin.currency, network: coin.network, address: address.address, ...(coin.method ? { method: coin.method } : {}) });
  }
  return options;
}

// Sample receiving options for mock mode only. Never used against send21.
const MOCK_LIGHTNING = "you@wallet.example";
const MOCK_OPTIONS = "usdc-sol:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,eth-base:0x52908400098527886E0F7030069857D2E4169EE7";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.SEND21_API_KEY?.trim() || null;
  const mock = !apiKey;
  if (apiKey && !apiKey.startsWith("s21_")) throw new Error("SEND21_API_KEY should start with s21_");
  const secret = env.SEND21_WEBHOOK_SECRET?.trim();
  if (!mock && !secret) throw new Error("SEND21_WEBHOOK_SECRET is missing (npm run webhook:register)");
  const port = num(env.PORT, 3000, 1, 65535, "PORT");
  const currency = (env.COFFEE_CURRENCY?.trim() || "EUR").toUpperCase();
  if (!isFiat(currency)) throw new Error("COFFEE_CURRENCY is not supported");
  const price = parseTotal(env.COFFEE_PRICE?.trim() || "3", currency, 1000);
  if (!price.ok) throw new Error(`COFFEE_PRICE: ${price.error}`);
  const configured = parseOptions(env.PAY_LIGHTNING, env.PAY_OPTIONS);
  const options = configured.length ? configured : mock ? parseOptions(MOCK_LIGHTNING, MOCK_OPTIONS) : [];
  if (!options.length) throw new Error("Set PAY_LIGHTNING and/or PAY_OPTIONS to your own receiving addresses");
  const creator = cleanText(env.CREATOR_NAME?.trim() || "this project", 32);
  if (!creator) throw new Error("CREATOR_NAME: plain text, max 32 characters");
  return {
    send21ApiKey: apiKey,
    send21ApiBase: env.SEND21_API_BASE?.trim() || "https://send21.io",
    webhookSecret: secret || randomBytes(32).toString("hex"),
    port,
    publicUrl: (env.PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/$/, ""),
    trustProxy: env.TRUST_PROXY === "1",
    creator,
    price: price.amount,
    currency,
    options,
    expiryHours: Math.round(num(env.COFFEE_EXPIRY_HOURS, 24, 1, 720, "COFFEE_EXPIRY_HOURS")),
    shortfallPercent: num(env.COFFEE_SHORTFALL_PERCENT, 2, 0, 10, "COFFEE_SHORTFALL_PERCENT"),
    wallAmounts: flag(env.WALL_SHOW_AMOUNTS, false),
    wallMessages: flag(env.WALL_SHOW_MESSAGES, true),
    dataFile: env.DATA_FILE?.trim() || "./data/coffee.json",
    mock,
  };
}
