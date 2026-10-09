import {
  ADDRESS_RE,
  assertMinReceive,
  assertSafeSwapTx,
  extractSwapAmountOut,
  extractSwapTx,
  minAmountOutFor,
  parseUnitsStr,
  resolvePair,
  SwapError,
  type BuiltSwap,
  type Side,
} from "@stockx/shared";
import { binanceGet, errorResponse } from "../../../../lib/binance";

export const dynamic = "force-dynamic";

/** Demo safety caps. Buy is in USDT, sell is in AAPLB. */
const MAX_IN: Record<Side, number> = { buy: 50, sell: 1 };
const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
const MAX_SLIPPAGE_BPS = 100; // 1%: the route refuses anything looser

interface ApiQuote {
  quoteId: string;
  executionMode: string;
  fromTokenAmount: string;
  toTokenAmount: string;
  priceImpactPercent: string;
  estimateGasFee: string;
  approveTarget: string;
  isBest?: boolean;
  dexRouterList?: { dexProtocol?: { dexName?: string } }[];
}

/**
 * GET /api/swap/build?side=buy&amount=5&wallet=0x...&slippageBps=50
 *
 * Always asks the aggregator for a FRESH quote and builds the swap from that quote's
 * id, so the browser never signs a transaction built from a stale quote. Called once
 * before the approval check and once again right before the swap is sent.
 * Token addresses come from our registry, never from the client.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const side = sp.get("side");
  const amount = sp.get("amount") ?? "";
  const wallet = sp.get("wallet") ?? "";
  const slippageBps = sp.get("slippageBps") === null ? DEFAULT_SLIPPAGE_BPS : Number(sp.get("slippageBps"));

  if (side !== "buy" && side !== "sell") return Response.json({ error: "side must be buy or sell" }, { status: 400 });
  if (!ADDRESS_RE.test(wallet)) return Response.json({ error: "A valid wallet address is required" }, { status: 400 });
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > MAX_IN[side]) {
    return Response.json({ error: `Amount must be between 0 and ${MAX_IN[side]}` }, { status: 400 });
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) {
    return Response.json({ error: `slippageBps must be an integer from 0 to ${MAX_SLIPPAGE_BPS}` }, { status: 400 });
  }

  try {
    const pair = side === "buy" ? resolvePair("USDT", "AAPLB") : resolvePair("AAPLB", "USDT");
    const amountIn = parseUnitsStr(amount, pair.tokenIn.decimals);
    const common = {
      binanceChainId: "56",
      fromTokenAddress: pair.tokenIn.address,
      toTokenAddress: pair.tokenOut.address,
      amount: amountIn.toString(),
    };

    const quotes = await binanceGet<ApiQuote[]>("/api/v1/dex/aggregator/quote", { ...common, userWalletAddress: wallet });
    const best = quotes.find((q) => q.isBest) ?? quotes[0];
    if (!best) return Response.json({ error: "No quote available" }, { status: 404 });
    if (!ADDRESS_RE.test(best.approveTarget)) {
      return Response.json({ error: "Quote came back without a valid approval target" }, { status: 502 });
    }
    // The quote must be for exactly the amount we asked for.
    if (BigInt(best.fromTokenAmount) !== amountIn) {
      return Response.json({ error: "Quote amount did not match the request" }, { status: 502 });
    }
    const quotedOut = BigInt(best.toTokenAmount);
    if (quotedOut <= 0n) return Response.json({ error: "Quote returned zero output" }, { status: 502 });

    const swap = await binanceGet<unknown>("/api/v1/dex/aggregator/swap", {
      ...common,
      userWalletAddress: wallet,
      slippagePercent: String(slippageBps / 100),
      quoteId: best.quoteId,
    });
    const tx = extractSwapTx(swap);
    assertSafeSwapTx(tx, { signer: wallet, tokenIn: pair.tokenIn.address, tokenOut: pair.tokenOut.address });
    // The amount the swap tx itself was built for wins over the earlier quote (same quoteId, normally equal).
    const swapOut = extractSwapAmountOut(swap);
    const amountOut = swapOut !== undefined && swapOut > 0n ? swapOut : quotedOut;
    assertMinReceive(tx, amountOut, slippageBps);

    const built: BuiltSwap = {
      side,
      tokenIn: pair.tokenIn.symbol,
      tokenOut: pair.tokenOut.symbol,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      // Derived here from OUR slippage setting. Never trusted from the API response.
      minAmountOut: minAmountOutFor(amountOut, slippageBps).toString(),
      slippageBps,
      executionMode: best.executionMode,
      approveTarget: best.approveTarget,
      priceImpactPercent: best.priceImpactPercent,
      route: (best.dexRouterList ?? []).map((r) => r.dexProtocol?.dexName ?? "?"),
      quoteId: best.quoteId,
      gasEstimate: best.estimateGasFee,
      builtAt: Date.now(),
      tx,
    };
    return Response.json(built);
  } catch (e) {
    if (e instanceof SwapError) {
      return Response.json({ error: e.message, code: e.code }, { status: 502 });
    }
    return errorResponse(e);
  }
}
