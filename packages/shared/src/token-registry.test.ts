import assert from "node:assert/strict";
import test from "node:test";
import { createBinanceProvider, type BuildFn, type WalletExecutor } from "./binance-provider";
import { createSwapHelper } from "./swap";
import { isSupportedStockRoute } from "./pocket/guards";
import { STOCKS } from "./stocks";
import { assertSafeSwapTx, assertTokenSafety, minAmountOutFor, resolvePair, type BuiltSwap } from "./swap-build";
import {
  getStockToken,
  getTokenInfo,
  isLiveSymbol,
  disabledSymbolsFor,
  listLiveStockTokens,
  listStockTokens,
  VERIFIED_LIVE_SYMBOLS,
} from "./token-registry";
import { TOKENS } from "./tokens";

const ENV = "NEXT_PUBLIC_DISABLED_TOKENS";
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

test("by default every registry token is live and listed; AAPLB stays the verified one", () => {
  withExtra(undefined, () => {
    assert.deepEqual([...VERIFIED_LIVE_SYMBOLS], ["AAPLB"]);
    assert.equal(listLiveStockTokens().length, 62);
    assert.equal(isLiveSymbol("NVDAB"), true);
    assert.equal(isLiveSymbol("AAPLB"), true);
    assert.equal(isLiveSymbol("SQQQB"), false, "not in the registry");
    assert.equal(STOCKS.length, 62);
    assert.ok(STOCKS.every((s) => s.status === "live" && s.note === undefined), "no coming-soon rows");
    assert.equal(STOCKS[0]!.token, "AAPLB");
  });
});

test("NEXT_PUBLIC_DISABLED_TOKENS pulls tokens back; typos and non-registry symbols disable nothing", () => {
  assert.deepEqual([...disabledSymbolsFor("nvdab, TSLAB")].sort(), ["NVDAB", "TSLAB"]);
  assert.deepEqual([...disabledSymbolsFor("SQQQB,USDT,AAPLx,,")], []);
  withExtra("NVDAB", () => {
    assert.equal(isLiveSymbol("NVDAB"), false);
    assert.equal(isLiveSymbol("TSLAB"), true);
    assert.equal(listLiveStockTokens().length, 61);
  });
  assert.equal(isLiveSymbol("NVDAB"), true, "restored");
});

test("resolvePair: live tokens trade against USDT only; everything else is refused", () => {
  withExtra(undefined, () => {
    const buy = resolvePair("USDT", "AAPLB");
    assert.deepEqual([buy.side, buy.stock.symbol, buy.tokenIn.symbol, buy.tokenOut.symbol], ["buy", "AAPLB", "USDT", "AAPLB"]);
    const sell = resolvePair("AAPLB", "USDT");
    assert.deepEqual([sell.side, sell.tokenIn.symbol, sell.tokenOut.symbol], ["sell", "AAPLB", "USDT"]);
    const conv = resolvePair("AAPLB", "NVDAB");
    assert.deepEqual([conv.side, conv.tokenIn.symbol, conv.tokenOut.symbol], ["convert", "AAPLB", "NVDAB"]);
    assert.equal(resolvePair("USDT", "NVDAB").stock.address, getStockToken("NVDAB")!.address);
    for (const [a, b] of [["USDT", "SQQQB"], ["SQQQB", "USDT"], ["AAPLB", "AAPLB"], ["AAPLB", "SQQQB"], ["USDT", "USDT"], ["USDT", "AAPLx"], ["BNB", "AAPLB"]] as const) {
      assert.throws(() => resolvePair(a, b), { code: "UNSUPPORTED_ROUTE" }, `${a}->${b}`);
    }
  });
  withExtra("NVDAB", () => {
    assert.throws(() => resolvePair("USDT", "NVDAB"), { code: "UNSUPPORTED_ROUTE" });
  });
});

test("agent guard route check follows the same live list", () => {
  withExtra(undefined, () => {
    assert.equal(isSupportedStockRoute("buy", "USDT", "AAPLB"), true);
    assert.equal(isSupportedStockRoute("sell", "AAPLB", "USDT"), true);
    assert.equal(isSupportedStockRoute("buy", "USDT", "NVDAB"), true);
    assert.equal(isSupportedStockRoute("buy", "USDT", "SQQQB"), false);
    assert.equal(isSupportedStockRoute("buy", "AAPLB", "USDT"), false);
  });
  withExtra("NVDAB", () => {
    assert.equal(isSupportedStockRoute("buy", "USDT", "NVDAB"), false);
    assert.equal(isSupportedStockRoute("sell", "NVDAB", "USDT"), false);
  });
});

const USDT_T = { address: TOKENS.USDT.address, decimals: 18 };
const NVDA_T = { address: getStockToken("NVDAB")!.address, decimals: 18 };
const tokenNode = (address: string, extra: Record<string, unknown> = {}) => ({ tokenContractAddress: address, decimal: "18", isHoneyPot: false, taxRate: "0", ...extra });
const goodNode = () => ({ fromToken: tokenNode(USDT_T.address), toToken: tokenNode(NVDA_T.address) });

test("assertTokenSafety accepts a clean quote and refuses wrong tokens, honeypots, taxes and silence", () => {
  assertTokenSafety(goodNode(), { from: USDT_T, to: NVDA_T });
  assertTokenSafety({ fromToken: tokenNode(USDT_T.address.toUpperCase().replace("0X", "0x")), toToken: tokenNode(NVDA_T.address) }, { from: USDT_T, to: NVDA_T });
  const bad: [string, unknown][] = [
    ["wrong output token", { ...goodNode(), toToken: tokenNode(TOKENS.AAPLB.address) }],
    ["wrong input token", { ...goodNode(), fromToken: tokenNode(NVDA_T.address) }],
    ["wrong decimals", { ...goodNode(), toToken: tokenNode(NVDA_T.address, { decimal: "6" }) }],
    ["honeypot", { ...goodNode(), toToken: tokenNode(NVDA_T.address, { isHoneyPot: true }) }],
    ["honeypot as string", { ...goodNode(), toToken: tokenNode(NVDA_T.address, { isHoneyPot: "true" }) }],
    ["taxed", { ...goodNode(), toToken: tokenNode(NVDA_T.address, { taxRate: "5" }) }],
    ["missing output", { fromToken: tokenNode(USDT_T.address) }],
    ["missing everything", {}],
    ["null", null],
  ];
  for (const [name, node] of bad) assert.throws(() => assertTokenSafety(node, { from: USDT_T, to: NVDA_T }), { code: "TOKEN_UNSAFE" }, name);
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
  await withExtra(undefined, async () => {
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

test("a token that is pulled back cannot reach the provider at all", async () => {
  await withExtra("NVDAB", async () => {
    const exec = {} as WalletExecutor;
    const h = createSwapHelper(createBinanceProvider({ executor: exec, wallet: "main", build: async () => { throw new Error("must not be called"); } }), { actor: "user" });
    await assert.rejects(h.quote({ tokenIn: "USDT", tokenOut: "NVDAB", amountIn: "5", spender: "main", receiver: "main" }), { code: "UNSUPPORTED_ROUTE" });
  });
});
