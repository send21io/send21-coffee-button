import { describe, expect, it } from "vitest";
import { coinById, coinFor } from "../src/currencies.js";
import { parseOptions } from "../src/config.js";
import { cleanTxId, LIGHTNING_LABEL, receivingAddresses, txUrl, wallTx } from "../src/explorer.js";
import { mockTxId } from "../src/server.js";
import { SOL } from "./helpers.js";

const SOL_SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const ETH_TX = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";
const BTC_TX = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";
const EVM = "0x52908400098527886E0F7030069857D2E4169EE7";
const BTC_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

// Stored values exactly as applyEvent keeps them: sentCurrency upper case, API network.
const paid = (currency: string, network: string, txId: string) => ({ currency, network, txId });

describe("tx explorer links", () => {
  it.each([
    ["SOL", "Solana"],
    ["USDC", "Solana"],
    ["USDT", "Solana"],
    ["EURC", "Solana"],
  ])("%s on %s → solscan", (cur, net) => {
    expect(txUrl(coinFor(cur, net), SOL_SIG)).toBe(`https://solscan.io/tx/${SOL_SIG}`);
  });

  it.each([
    ["ETH", "Ethereum"],
    ["USDC", "Ethereum"],
    ["USDT", "Ethereum"],
    ["EURC", "Ethereum"],
  ])("%s on %s → etherscan", (cur, net) => {
    expect(txUrl(coinFor(cur, net), ETH_TX)).toBe(`https://etherscan.io/tx/${ETH_TX}`);
  });

  it("on-chain BTC → mempool.space, lower-cased", () => {
    expect(txUrl(coinFor("BTC", "Mainnet"), BTC_TX.toUpperCase())).toBe(`https://mempool.space/tx/${BTC_TX}`);
  });

  it("Lightning never gets a link", () => {
    expect(txUrl(coinFor("BTC", "Mainnet", "Lightning"), BTC_TX)).toBeNull();
  });

  it("chains without a mapped explorer, and unknown or test networks, get no link", () => {
    expect(txUrl(coinById("usdc-base"), ETH_TX)).toBeNull();
    expect(txUrl(coinById("eth-arb"), ETH_TX)).toBeNull();
    expect(txUrl(coinById("usdc-pol"), ETH_TX)).toBeNull();
    expect(txUrl(coinFor("USDC", "Devnet"), SOL_SIG)).toBeNull();
    expect(txUrl(coinFor("ETH", "Sepolia"), ETH_TX)).toBeNull();
  });

  it.each([
    ["solana", "not base58 0OIl" + "1".repeat(60)],
    ["solana", "short1234"],
    ["solana", ETH_TX],
    ["evm", BTC_TX], // no 0x
    ["evm", ETH_TX + "00"],
    ["evm", "0x" + "g".repeat(64)],
    ["bitcoin", ETH_TX],
    ["bitcoin", "mock-3f6c2a9e"],
    ["bitcoin", `${BTC_TX}" onclick="x`],
    ["solana", `${SOL_SIG}/../../evil`],
  ] as const)("invalid %s txId %s → no id, no link", (kind, id) => {
    expect(cleanTxId(kind, id)).toBeNull();
  });

  it("an invalid txId gives no link", () => {
    expect(txUrl(coinFor("USDC", "Solana"), "mock-123")).toBeNull();
    expect(txUrl(coinFor("USDC", "Ethereum"), "javascript:alert(1)")).toBeNull();
    expect(txUrl(coinFor("BTC", "Mainnet"), "")).toBeNull();
  });
});

describe("wallTx", () => {
  const ln = parseOptions("me@wallet.example", `usdc-sol:${SOL},usdt-eth:${EVM}`);
  const onchain = parseOptions(undefined, `btc:${BTC_ADDR}`);
  const both = parseOptions("me@wallet.example", `btc:${BTC_ADDR}`);

  it("Solana: id, solscan link, receiving address", () => {
    expect(wallTx(paid("USDC", "Solana", SOL_SIG), ln)).toEqual({ chain: "solana", label: "USDC · Solana", id: SOL_SIG, url: `https://solscan.io/tx/${SOL_SIG}`, to: SOL });
  });

  it("USDT on Ethereum: etherscan", () => {
    expect(wallTx(paid("USDT", "Ethereum", ETH_TX), ln)).toMatchObject({ chain: "ethereum", url: `https://etherscan.io/tx/${ETH_TX}`, to: EVM });
  });

  it("BTC/Mainnet on an order that offered only Lightning: Lightning, not public, no id", () => {
    expect(wallTx(paid("BTC", "Mainnet", BTC_TX), ln)).toEqual({ chain: "lightning", label: LIGHTNING_LABEL, id: null, url: null, to: null });
  });

  it("BTC/Mainnet on an order that offered only on-chain BTC: mempool.space", () => {
    expect(wallTx(paid("BTC", "Mainnet", BTC_TX), onchain)).toMatchObject({ chain: "bitcoin", url: `https://mempool.space/tx/${BTC_TX}`, to: BTC_ADDR });
  });

  it("BTC/Mainnet when both were offered: no guess, no link", () => {
    expect(wallTx(paid("BTC", "Mainnet", BTC_TX), both)).toMatchObject({ chain: null, url: null });
    expect(wallTx({ ...paid("BTC", "Mainnet", BTC_TX), method: "Lightning" }, both)).toMatchObject({ chain: "lightning", url: null, id: null });
    expect(wallTx({ ...paid("BTC", "Mainnet", BTC_TX), method: "MultiOutput" }, both)).toMatchObject({ chain: "bitcoin", url: `https://mempool.space/tx/${BTC_TX}` });
  });

  it("invalid txId: label stays, no id, no link", () => {
    expect(wallTx(paid("USDC", "Solana", "mock-1"), ln)).toMatchObject({ chain: null, label: "USDC · Solana", id: null, url: null });
  });

  it("receiving addresses: on-chain only, explorer address links", () => {
    expect(receivingAddresses([...ln, ...onchain])).toEqual([
      { label: "USDC · Solana", address: SOL, url: `https://solscan.io/account/${SOL}` },
      { label: "USDT · Ethereum", address: EVM, url: `https://etherscan.io/address/${EVM}` },
      { label: "BTC · Bitcoin", address: BTC_ADDR, url: `https://mempool.space/address/${BTC_ADDR}` },
    ]);
    expect(receivingAddresses(parseOptions(undefined, `usdc-base:${EVM}`))).toEqual([{ label: "USDC · Base", address: EVM, url: null }]);
  });
});

describe("mock txIds", () => {
  it("valid format per chain, obviously fake", () => {
    const sol = mockTxId({ network: "Solana" });
    expect(sol.startsWith("MockTxFake")).toBe(true);
    expect(cleanTxId("solana", sol)).toBe(sol);
    const eth = mockTxId({ network: "Ethereum" });
    expect(eth.startsWith("0x0000000000000000")).toBe(true);
    expect(cleanTxId("evm", eth)).toBe(eth);
    expect(cleanTxId("bitcoin", mockTxId({ network: "Mainnet" }))).toMatch(/^0{16}/);
  });
});

describe("WALL_SHOW_TX", () => {
  it("defaults to on, false turns it off", async () => {
    const { loadConfig } = await import("../src/config.js");
    expect(loadConfig({}).wallTx).toBe(true);
    expect(loadConfig({ WALL_SHOW_TX: "false" }).wallTx).toBe(false);
    expect(loadConfig({ WALL_SHOW_TX: "0" }).wallTx).toBe(false);
  });
});
