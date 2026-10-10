import { isAddress, formatUnits, parseUnits } from "viem";
import { getTokenInfo, isLiveSymbol, TOKENS } from "@stockx/shared";
import { binanceGet, errorResponse } from "../../../../lib/binance";

export const dynamic = "force-dynamic";

const MAX_USDT = 50; // demo safety cap

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

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const amount = sp.get("amount") ?? "";
  const wallet = sp.get("wallet") ?? "";
  const symbol = (sp.get("token") ?? "AAPLB").toUpperCase();
  const stock = getTokenInfo(symbol);

  // USDT -> a live stock token. The client names a symbol; addresses always come from our registry.
  if (!stock || !isLiveSymbol(symbol)) {
    return Response.json({ error: `${symbol} is not tradable yet` }, { status: 400 });
  }
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > MAX_USDT) {
    return Response.json({ error: `Amount must be between 0 and ${MAX_USDT} USDT` }, { status: 400 });
  }
  if (wallet && !isAddress(wallet)) {
    return Response.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  const params: Record<string, string> = {
    binanceChainId: "56",
    fromTokenAddress: TOKENS.USDT.address,
    toTokenAddress: stock.address,
    amount: parseUnits(amount, TOKENS.USDT.decimals).toString(),
  };
  if (wallet) params.userWalletAddress = wallet;

  try {
    const quotes = await binanceGet<ApiQuote[]>("/api/v1/dex/aggregator/quote", params);
    const best = quotes.find((q) => q.isBest) ?? quotes[0];
    if (!best) return Response.json({ error: "No quote available" }, { status: 404 });
    return Response.json({
      quoteId: best.quoteId,
      executionMode: best.executionMode,
      amountIn: formatUnits(BigInt(best.fromTokenAmount), TOKENS.USDT.decimals),
      amountOut: formatUnits(BigInt(best.toTokenAmount), stock.decimals),
      priceImpactPercent: best.priceImpactPercent,
      route: (best.dexRouterList ?? []).map((r) => r.dexProtocol?.dexName ?? "?"),
      approveTarget: best.approveTarget,
      gasEstimate: best.estimateGasFee,
      quotedAt: Date.now(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}