import assert from "node:assert/strict";
import test from "node:test";
import { createBinanceProvider, type BuildFn, type WalletExecutor } from "./binance-provider";
import { createSwapHelper } from "./swap";
import { isSupportedStockRoute } from "./pocket/guards";
import { STOCKS } from "./stocks";
import { assertSafeSwapTx, minAmountOutFor, resolvePair, type BuiltSwap } from "./swap-build";
import {
  getStockToken,
  getTokenInfo,
  isLiveSymbol,
  listLiveStockTokens,
  listStockTokens,
  liveSymbolsFor,
  VERIFIED_LIVE_SYMBOLS,
} from "./token-registry";
import { TOKENS } from "./tokens";

const ENV = "NEXT_PUBLIC_EXTRA_LIVE";
function withExtra<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env[ENV];
  if (value === undefined) delete process.env[ENV]; else process.env[ENV] = value;
  try { return fn(); } finally { if (prev === undefined) delete process.env[ENV]; else process.env[ENV] = prev; }
}

test("registry data is sane: unique, lowercase 42-char addresses, 18 decimals, no leverage", () => {
  const rows = listStockTokens();
  assert.equal(rows.length, 62);
  assert.equal(new Set(rows.map((r) => r.symbol)).size, rows.length);
  assert.equal(new Set(rows.map((r) => r.address)).size, rows.length);
  for (const r of rows) {
    assert.match(r.address, /^0x[0-9a-f]{40}$/, r.symbol);
    assert.equal(r.decimals, 18, r.symbol);
    assert.ok(r.priceImpactPct <= 0.5, `${r.symbol} impact`);
    assert.doesNotMatch(r.name, /\b[2-9]x\b|ultrapro|\bbull\b|inverse|\bshort\b|\blong\b/i, `${r.symbol} looks leveraged`);
  }
  for (const banned of ["TQQQB", "SQQQB", "MUUB", "KORUB", "INTWB", "QNTB"]) assert.equal(getStockToken(banned), undefined, banned);
});

test("AAPLB in the registry is the exact token the app has always traded", () => {
  assert.equal(getStockToken("AAPLB")!.address, TOKENS.AAPLB.address);
  assert.equal(getTokenInfo("AAPLB")!.decimals, TOKENS.AAPLB.decimals);
  assert.equal(getTokenInfo("USDT")!.address, TOKENS.USDT.address);
  assert.equal(getTokenInfo("NOPE"), undefined);
});

test("by default only AAPLB is live; every other registry token is 'soon'", () => {
  withExtra(undefined, () => {
    assert.deepEqual([...VERIFIED_LIVE_SYMBOLS], ["AAPLB"]);
    assert.deepEqual(listLiveStockTokens().map((t) => t.symbol), ["AAPLB"]);
    assert.equal(isLiveSymbol("NVDAB"), false);
    const live = STOCKS.filter((s) => s.status === "live");
    assert.deepEqual(live.map((s) => s.token), ["AAPLB"]);
    assert.equal(STOCKS.length, 62);
    assert.equal(STOCKS[0]!.token, "AAPLB", "live tokens sort first");
  });
});

test("NEXT_PUBLIC_EXTRA_LIVE adds known symbols only; typos and non-registry symbols enable nothing", () => {
  assert.deepEqual([...liveSymbolsFor("nvdab, TSLAB")].sort(), ["AAPLB", "NVDAB", "TSLAB"]);
  assert.deepEqual([...liveSymbolsFor("SQQQB,USDT,AAPLX,,")], ["AAPLB"]);
  withExtra("NVDAB", () => {
    assert.equal(isLiveSymbol("NVDAB"), true);
    assert.equal(isLiveSymbol("TSLAB"), false);
  });
  assert.equal(isLiveSymbol("NVDAB"), false, "restored");
});

test("resolvePair: live tokens trade against USDT only; everything else is refused", () => {
  withExtra(undefined, () => {
    const buy = resolvePair("USDT", "AAPLB");
    assert.deepEqual([buy.side, buy.stock.symbol, buy.tokenIn.symbol, buy.tokenOut.symbol], ["buy", "AAPLB", "USDT", "AAPLB"]);
    const sell = resolvePair("AAPLB", "USDT");
    assert.deepEqual([sell.side, sell.tokenIn.symbol, sell.tokenOut.symbol], ["sell", "AAPLB", "USDT"]);
    for (const [a, b] of [["USDT", "NVDAB"], ["NVDAB", "USDT"], ["USDT", "SQQQB"], ["AAPLB", "NVDAB"], ["USDT", "USDT"], ["USDT", "AAPLx"], ["BNB", "AAPLB"]] as const) {
      assert.throws(() => resolvePair(a, b), { code: "UNSUPPORTED_ROUTE" }, `${a}->${b}`);
    }
  });
  withExtra("NVDAB", () => {
    assert.equal(resolvePair("USDT", "NVDAB").stock.address, getStockToken("NVDAB")!.address);
  });
});

test("agent guard route check follows the same live list", () => {
  withExtra(undefined, () => {
    assert.equal(isSupportedStockRoute("buy", "USDT", "AAPLB"), true);
    assert.equal(isSupportedStockRoute("sell", "AAPLB", "USDT"), true);
    assert.equal(isSupportedStockRoute("buy", "USDT", "NVDAB"), false);
    assert.equal(isSupportedStockRoute("sell", "NVDAB", "USDT"), false);
    assert.equal(isSupportedStockRoute("buy", "AAPLB", "USDT"), false);
  });
});

// ---------- a second token through the real provider ----------

const USER = "0x1111111111111111111111111111111111111111";
const ROUTER = "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5";
const E18 = 10n ** 18n;

function builtFor(symbol: string, side: "buy" | "sell"): BuiltSwap {
  const amountIn = 5n * E18;
  const amountOut = E18 / 40n;
  return {
    side, tokenIn: side === "buy" ? "USDT" : symbol, tokenOut: side === "buy" ? symbol : "USDT",
    amountIn: amountIn.toString(), amountOut: amountOut.toString(), minAmountOut: minAmountOutFor(amountOut, 50).toString(),
    slippageBps: 50, executionMode: "SWAP", approveTarget: ROUTER, priceImpactPercent: "0.01", route: ["x"], quoteId: "q",
    gasEstimate: "250000", builtAt: 0, tx: { to: ROUTER, data: "0x12345678abcdef", value: "0" },
  };
}

test("a second live token goes through the provider: build gets the token, approval targets that token", async () => {
  await withExtra("NVDAB", async () => {
    const nvda = getStockToken("NVDAB")!;
    const sent: { to: string }[] = [];
    let allowance = 0n;
    const exec: WalletExecutor = {
      address: USER,
      chainId: async () => 56,
      tokenBalance: async () => 100n * E18,
      allowance: async () => allowance,
      dryRun: async () => 210_000n,
      send: async (tx) => { sent.push(tx); allowance = 10n * E18; return "0x" + String(sent.length).padStart(64, "0"); },
      waitForReceipt: async () => ({ status: "success" }),
    };
    const seen: string[] = [];
    const build: BuildFn = async ({ side, token }) => { seen.push(`${side}:${token}`); return builtFor(token, side); };
    const h = createSwapHelper(createBinanceProvider({ executor: exec, wallet: "main", build }), { actor: "user" });

    // sell NVDAB: approval must be sent to the NVDAB contract, not AAPLB or USDT
    const q = await h.quote({ tokenIn: "NVDAB", tokenOut: "USDT", amountIn: "5", spender: "main", receiver: "main" });
    assert.equal((await h.simulate(q)).ok, true);
    await h.execute(q, "main");
    assert.equal(sent[0]!.to, nvda.address);
    assert.deepEqual(seen, ["sell:NVDAB", "sell:NVDAB"]);

    // and the safe-tx guard now treats NVDAB as a token contract, not a router
    assert.throws(
      () => assertSafeSwapTx({ to: nvda.address, data: "0x12345678abcdef", value: "0" }, { signer: USER, tokenIn: TOKENS.USDT.address, tokenOut: nvda.address }),
      { code: "UNSAFE_TX" },
    );
  });
});

test("a token that is not live cannot reach the provider at all", async () => {
  await withExtra(undefined, async () => {
    const exec = {} as WalletExecutor;
    const h = createSwapHelper(createBinanceProvider({ executor: exec, wallet: "main", build: async () => { throw new Error("must not be called"); } }), { actor: "user" });
    await assert.rejects(h.quote({ tokenIn: "USDT", tokenOut: "NVDAB", amountIn: "5", spender: "main", receiver: "main" }), { code: "UNSUPPORTED_ROUTE" });
  });
});
