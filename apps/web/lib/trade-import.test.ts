import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrade, type DecodedTransfer, type TokenMeta } from "./trade-import";

const USDT = "0x55d398326f99059ff775485246999027b3197955";
const AAPLB = "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a";
const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
const OWNER = "0x0648e8aefd446068d36ca5446494fa912ba51b02";
const ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5";
const POOL = "0xe4df7c2dfbda34d75b5bcbd484c66a6e67f815e9";
const tokens: TokenMeta[] = [
  { symbol: "USDT", address: USDT, decimals: 18 },
  { symbol: "AAPLB", address: AAPLB, decimals: 18 },
  { symbol: "NVDAB", address: NVDAB, decimals: 18 },
];
const t = (token: string, from: string, to: string, value: string): DecodedTransfer => ({ token, from, to, value: BigInt(value) });

test("classifies the real pocket buy (0.43 USDT -> 0.001277... AAPLB) through router hops", () => {
  const r = classifyTrade(OWNER, [
    t(USDT, OWNER, ROUTER, "430000000000000000"),
    t(USDT, ROUTER, POOL, "430000000000000000"),
    t(AAPLB, POOL, ROUTER, "1277142461874045"),
    t(AAPLB, ROUTER, OWNER, "1277142461874045"),
  ], tokens);
  assert.deepEqual(r, { side: "buy", token: "AAPLB", inSym: "USDT", amountIn: "0.43", outSym: "AAPLB", amountOut: "0.001277142461874045" });
});

test("classifies a sell", () => {
  const r = classifyTrade(OWNER, [t(AAPLB, OWNER, ROUTER, "1000000000000000"), t(USDT, ROUTER, OWNER, "340000000000000000")], tokens);
  assert.deepEqual(r, { side: "sell", token: "AAPLB", inSym: "AAPLB", amountIn: "0.001", outSym: "USDT", amountOut: "0.34" });
});

test("returns null for transfers that are not a trade for this owner", () => {
  assert.equal(classifyTrade(OWNER, [t(USDT, ROUTER, POOL, "5")], tokens), null);
  assert.equal(classifyTrade(OWNER, [t(USDT, OWNER, ROUTER, "5")], tokens), null); // no stock leg
  assert.equal(classifyTrade(OWNER, [t(AAPLB, ROUTER, OWNER, "5")], tokens), null); // no USDT leg
});

test("refuses ambiguous trades with two stock tokens", () => {
  const r = classifyTrade(OWNER, [t(USDT, OWNER, ROUTER, "10"), t(AAPLB, ROUTER, OWNER, "1"), t(NVDAB, ROUTER, OWNER, "1")], tokens);
  assert.equal(r, null);
});

test("ignores unknown tokens and other owners", () => {
  const r = classifyTrade(OWNER, [t("0x1111111111111111111111111111111111111111", OWNER, ROUTER, "9")], tokens);
  assert.equal(r, null);
  assert.equal(classifyTrade("0x2222222222222222222222222222222222222222", [t(USDT, OWNER, ROUTER, "1"), t(AAPLB, ROUTER, OWNER, "1")], tokens), null);
});
