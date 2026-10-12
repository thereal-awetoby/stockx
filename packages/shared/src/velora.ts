import { SwapError } from "./errors";

/** Velora (formerly ParaSwap) public market API. No key needed. Server-side use only. */
export const VELORA_HOST = "https://api.paraswap.io";

export interface VeloraPriceRoute {
  srcToken: string;
  destToken: string;
  srcAmount: string;
  destAmount: string;
  srcDecimals: number;
  destDecimals: number;
  /** Spender to approve. */
  tokenTransferProxy: string;
  /** The router the swap transaction must call. */
  contractAddress: string;
  gasCostUSD?: string;
  srcUSD?: string;
  destUSD?: string;
  [k: string]: unknown;
}

export interface VeloraTx { from: string; to: string; value: string; data: string; chainId: number }

type FetchLike = typeof fetch;
const TIMEOUT_MS = 15_000;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

export async function veloraPrice(
  p: { network: number; src: string; srcDecimals: number; dest: string; destDecimals: number; amount: bigint },
  f: FetchLike = fetch,
): Promise<VeloraPriceRoute> {
  const qs = new URLSearchParams({
    srcToken: p.src, srcDecimals: String(p.srcDecimals), destToken: p.dest, destDecimals: String(p.destDecimals),
    amount: p.amount.toString(), side: "SELL", network: String(p.network), version: "6.2",
  });
  const res = await f(`${VELORA_HOST}/prices?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const j = await readJson(res);
  const route = j.priceRoute as VeloraPriceRoute | undefined;
  if (!res.ok || !route?.destAmount || !route.tokenTransferProxy || !route.contractAddress) {
    throw new SwapError("NO_ROUTE", `No route found for this swap (${String(j.error ?? res.status).slice(0, 80)})`);
  }
  return route;
}

export async function veloraBuild(
  p: { network: number; route: VeloraPriceRoute; userAddress: string; slippageBps: number },
  f: FetchLike = fetch,
): Promise<VeloraTx> {
  const res = await f(`${VELORA_HOST}/transactions/${p.network}?ignoreChecks=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      srcToken: p.route.srcToken, destToken: p.route.destToken, srcAmount: p.route.srcAmount,
      srcDecimals: p.route.srcDecimals, destDecimals: p.route.destDecimals,
      slippage: p.slippageBps, priceRoute: p.route, userAddress: p.userAddress,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const j = await readJson(res);
  if (!res.ok || typeof j.to !== "string" || typeof j.data !== "string") {
    throw new SwapError("BUILD_FAILED", `Could not build the swap (${String(j.error ?? res.status).slice(0, 80)})`);
  }
  return { from: String(j.from ?? p.userAddress), to: j.to, value: String(j.value ?? "0"), data: j.data, chainId: Number(j.chainId ?? p.network) };
}
