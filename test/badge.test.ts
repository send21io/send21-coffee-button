import { describe, expect, it } from "vitest";
import { badgeSvg } from "../src/badge.js";
import { parseOptions } from "../src/config.js";
import { coinsLine } from "../src/pages.js";
import { SOL } from "./helpers.js";

describe("badgeSvg", () => {
  it("is a small accessible SVG", () => {
    const svg = badgeSvg("☕ buy me a coffee");
    expect(svg).toMatch(/^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('aria-label="☕ buy me a coffee | send21"');
    expect(svg).not.toMatch(/<script|href=/i);
  });
  it("escapes its text", () => {
    const svg = badgeSvg(`<script>"&'`);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&#60;script&#62;");
  });
});

describe("parseOptions", () => {
  it("puts Lightning first", () => {
    const o = parseOptions("me@wallet.example", `usdc-sol:${SOL}`);
    expect(o[0]).toEqual({ currency: "Btc", network: "Mainnet", address: "me@wallet.example", method: "Lightning" });
    expect(coinsLine(o)).toMatch(/^⚡ Lightning · /);
  });
  it("only offers documented coin + network pairs", () => {
    const evm = "0x52908400098527886E0F7030069857D2E4169EE7";
    expect(() => parseOptions(undefined, `usdt-base:${evm}`)).toThrow(/unknown coin/);
    expect(() => parseOptions(undefined, `btc-base:${evm}`)).toThrow(/unknown coin/);
    expect(() => parseOptions(undefined, `usdt-tron:${evm}`)).toThrow(/unknown coin/);
    expect(() => parseOptions(undefined, `usdt-polygon:${evm}`)).toThrow(/unknown coin/);
    expect(() => parseOptions(undefined, `usdt-arbitrum:${evm}`)).toThrow(/unknown coin/);
    expect(parseOptions(undefined, `usdt-eth:${evm},usdt-sol:${SOL}`)).toHaveLength(2);
  });
  it("checks addresses and duplicates", () => {
    expect(() => parseOptions("not a lightning address", undefined)).toThrow();
    expect(() => parseOptions(undefined, `usdc-sol:0xnope`)).toThrow();
    expect(() => parseOptions(undefined, `usdc-sol:${SOL},usdc-sol:${SOL}`)).toThrow(/twice/);
  });
});
