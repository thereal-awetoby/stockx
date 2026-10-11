import assert from "node:assert/strict";
import test from "node:test";
import { tradesFromTokenTx, type TokenTxRow } from "./history";
import type { TokenMeta } from "./trade-import";

const USDT = "0x55d398326f99059ff775485246999027b3197955";
const AAPLB = "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a";
const OWNER = "0x0648e8aefd446068d36ca5446494fa912ba51b02";
const ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5";
const tokens: TokenMeta[] = [{ symbol: "USDT", address: USDT, decimals: 18 }, { symbol: "AAPLB", address: AAPLB, decimals: 18 }];
const row = (hash: string, contractAddress: string, from: string, to: string, value: string, timeStamp = "1791626614"): TokenTxRow => ({ hash, contractAddress, from, to, value, timeStamp });

test("groups transfers by hash and returns only real trades, newest first", () => {
  const rows = [
    row("0xaaa", USDT, OWNER, ROUTER, "430000000000000000", "1791626614"),
    row("0xaaa", AAPLB, ROUTER, OWNER, "1277142461874045", "1791626614"),
    row("0xbbb", USDT, "0x6fe5b6d32c724e2a0761c8fa49e171923d71d7ba", OWNER, "5000000000000000000", "1791620000"), // a plain funding transfer
    row("0xccc", AAPLB, OWNER, ROUTER, "1000000000000000", "1791700000"),
    row("0xccc", USDT, ROUTER, OWNER, "340000000000000000", "1791700000"),
  ];
  const t = tradesFromTokenTx(OWNER, rows, tokens);
  assert.deepEqual(t.map((x) => [x.txHash, x.side]), [["0xccc", "sell"], ["0xaaa", "buy"]]);
  assert.equal(t[1]!.t, 1791626614000);
  assert.equal(t[1]!.amountIn, "0.43");
});

test("skips malformed rows instead of throwing", () => {
  const bad = [{ hash: "0xd", from: OWNER, to: ROUTER, value: "not-a-number", contractAddress: USDT, timeStamp: "1" }] as TokenTxRow[];
  assert.deepEqual(tradesFromTokenTx(OWNER, bad, tokens), []);
  assert.deepEqual(tradesFromTokenTx(OWNER, [], tokens), []);
});
