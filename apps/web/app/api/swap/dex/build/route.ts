import {
  ADDRESS_RE,
  CHAINS,
  getEthTradableToken,
  parseUnitsStr,
  SwapError,
  veloraBuild,
  veloraPrice,
  type BuiltDex,
  type DexToken,
} from "@stockx/shared";

export const dynamic = "force-dynamic";

const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 100;

/**
 * GET /api/swap/dex/build?chain=ethereum&tokenIn=USDC&tokenOut=AAPLon&amount=5&wallet=0x...&slippageBps=50
 *
 * Ethereum swaps (Velora aggregator). Always a FRESH route and transaction, built for the caller's wallet.
 * Token addresses come from our registry, never from the client: one leg is the chain's stablecoin,
 * the other a tradable stock token.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const chain = CHAINS.ethereum;
  if (sp.get("chain") !== chain.key) return Response.json({ error: "Unsupported chain", code: "UNSUPPORTED_CHAIN" }, { status: 400 });

  const wallet = sp.get("wallet") ?? "";
  const amount = sp.get("amount") ?? "";
  const slippageBps = sp.get("slippageBps") === null ? DEFAULT_SLIPPAGE_BPS : Number(sp.get("slippageBps"));
  if (!ADDRESS_RE.test(wallet)) return Response.json({ error: "A valid wallet address is required" }, { status: 400 });
  if (!/^\d+(\.\d{1,18})?$/.test(amount)) return Response.json({ error: "Enter a valid amount" }, { status: 400 });
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) {
    return Response.json({ error: `Slippage must be between 1 and ${MAX_SLIPPAGE_BPS} bps` }, { status: 400 });
  }

  const cash: DexToken = chain.cash;
  const find = (s: string | null): DexToken | undefined => (s === cash.symbol ? cash : s ? getEthTradableToken(s) : undefined);
  const tokenIn = find(sp.get("tokenIn"));
  const tokenOut = find(sp.get("tokenOut"));
  if (!tokenIn || !tokenOut) return Response.json({ error: "Token is not tradable on Ethereum", code: "TOKEN_NOT_LIVE" }, { status: 400 });
  if ((tokenIn === cash) === (tokenOut === cash)) {
    return Response.json({ error: `Swaps are ${cash.symbol} to a stock token or back`, code: "UNSUPPORTED_PAIR" }, { status: 400 });
  }

  try {
    const amountIn = parseUnitsStr(amount, tokenIn.decimals);
    if (amountIn <= 0n) return Response.json({ error: "Amount must be greater than 0" }, { status: 400 });
    const route = await veloraPrice({
      network: chain.id, src: tokenIn.address, srcDecimals: tokenIn.decimals,
      dest: tokenOut.address, destDecimals: tokenOut.decimals, amount: amountIn,
    });
    const tx = await veloraBuild({ network: chain.id, route, userAddress: wallet, slippageBps });
    const body: BuiltDex = {
      tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol,
      amountIn: amountIn.toString(), amountOut: route.destAmount,
      slippageBps, approveTarget: route.tokenTransferProxy, route,
      tx: { to: tx.to, data: tx.data, value: tx.value, from: tx.from },
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof SwapError) return Response.json({ error: e.message, code: e.code }, { status: 502 });
    return Response.json({ error: "Could not get an Ethereum quote right now", code: "BUILD_FAILED" }, { status: 502 });
  }
}
