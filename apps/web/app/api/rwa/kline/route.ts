import { getStockToken, KLINE_RANGES, parseKlines, type KlineRange } from "@stockx/shared";
import { binancePublic, PUBLIC_PATHS } from "../../../../lib/binance-public";

export const dynamic = "force-dynamic";

/** GET /api/rwa/kline?token=AAPLB&range=1D  (1D, 1W, 1M, 3M, ALL). The address comes from our registry, never the client. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const token = getStockToken((sp.get("token") ?? "").toUpperCase());
  const range = (sp.get("range") ?? "1D").toUpperCase() as KlineRange;
  const cfg = KLINE_RANGES[range];
  if (!token || !cfg) return Response.json({ error: "Unknown token or range" }, { status: 400 });

  try {
    const data = await binancePublic<{ klineInfos?: unknown }>(PUBLIC_PATHS.kline, {
      chainId: 56,
      contractAddress: token.address,
      interval: cfg.interval,
      limit: cfg.limit,
    });
    const series = parseKlines(data?.klineInfos, range);
    if (!series) return Response.json({ error: "No chart data yet" }, { status: 404 });
    return Response.json(series, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch {
    return Response.json({ error: "Chart data is unavailable right now" }, { status: 502 });
  }
}
