import {
  ADDRESS_RE,
  assertSafeBridge,
  bridgeSource,
  bridgeTarget,
  CHAINS,
  parseUnitsStr,
  SwapError,
  type BridgeBuilt,
  type BridgeTarget,
  type ChainKey,
} from "@stockx/shared";

export const dynamic = "force-dynamic";

const LIFI = "https://li.quest/v1";
const SLIPPAGE = 0.005; // 0.5%
const KEYS: ChainKey[] = ["bsc", "ethereum"];

const num = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const sumUsd = (list: unknown): number | null => {
  if (!Array.isArray(list)) return null;
  let t = 0;
  for (const x of list) t += num((x as { amountUSD?: unknown })?.amountUSD) ?? 0;
  return t;
};

/**
 * GET /api/bridge/quote?from=bsc&to=ethereum&target=cash&amount=20&wallet=0x...
 *
 * Asks LI.FI for a route that moves the stablecoin from one chain to the other (target=cash), or turns it
 * into the destination chain's native coin for gas (target=gas). Tokens and chains come from our own
 * lists, never from the client, and the answer is checked before it is returned. The key is optional and server-only.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") as ChainKey | null;
  const to = sp.get("to") as ChainKey | null;
  const target = (sp.get("target") ?? "cash") as BridgeTarget;
  const amount = sp.get("amount") ?? "";
  const wallet = sp.get("wallet") ?? "";

  if (!from || !to || !KEYS.includes(from) || !KEYS.includes(to) || from === to) return Response.json({ error: "Pick two different chains" }, { status: 400 });
  if (target !== "cash" && target !== "gas") return Response.json({ error: "target must be cash or gas" }, { status: 400 });
  if (!ADDRESS_RE.test(wallet)) return Response.json({ error: "A valid wallet address is required" }, { status: 400 });
  if (!/^\d+(\.\d{1,18})?$/.test(amount)) return Response.json({ error: "Enter a valid amount" }, { status: 400 });

  const src = bridgeSource(from);
  const dst = bridgeTarget(to, target);
  const fromAmount = parseUnitsStr(amount, src.decimals);
  if (fromAmount <= 0n) return Response.json({ error: "Amount must be greater than 0" }, { status: 400 });

  const qs = new URLSearchParams({
    fromChain: String(CHAINS[from].id), toChain: String(CHAINS[to].id),
    fromToken: src.address, toToken: dst.address,
    fromAmount: fromAmount.toString(), fromAddress: wallet, slippage: String(SLIPPAGE),
  });
  const headers: Record<string, string> = {};
  if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;

  try {
    const res = await fetch(`${LIFI}/quote?${qs}`, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const j = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const msg = String(j?.message ?? `HTTP ${res.status}`).slice(0, 140);
      return Response.json({ error: `No bridge route found (${msg})`, code: "NO_ROUTE" }, { status: 502 });
    }
    const est = j.estimate ?? {};
    const txr = j.transactionRequest ?? {};
    if (typeof txr.to !== "string" || typeof txr.data !== "string" || !est.toAmount || !est.toAmountMin || !est.approvalAddress) {
      return Response.json({ error: "Bridge provider returned an incomplete quote", code: "BAD_BRIDGE_RESPONSE" }, { status: 502 });
    }
    const built: BridgeBuilt = {
      fromChain: Number(j.action?.fromChainId ?? CHAINS[from].id),
      toChain: Number(j.action?.toChainId ?? CHAINS[to].id),
      fromToken: String(j.action?.fromToken?.address ?? ""),
      toToken: String(j.action?.toToken?.address ?? ""),
      fromAmount: String(est.fromAmount ?? j.action?.fromAmount ?? ""),
      toAmount: String(est.toAmount),
      toAmountMin: String(est.toAmountMin),
      approvalAddress: String(est.approvalAddress),
      tx: { to: txr.to, data: txr.data, value: BigInt(txr.value ?? "0x0").toString(), chainId: Number(txr.chainId ?? CHAINS[from].id) },
      tool: String(j.toolDetails?.name ?? j.tool ?? "bridge"),
      feeUsd: sumUsd(est.feeCosts),
      gasUsd: sumUsd(est.gasCosts),
      durationSec: num(est.executionDuration),
    };
    assertSafeBridge(built, { fromChain: CHAINS[from].id, toChain: CHAINS[to].id, fromToken: src.address, toToken: dst.address, fromAmount });
    return Response.json(built, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof SwapError) return Response.json({ error: e.message, code: e.code }, { status: 502 });
    return Response.json({ error: "Could not get a bridge quote right now", code: "BUILD_FAILED" }, { status: 502 });
  }
}
