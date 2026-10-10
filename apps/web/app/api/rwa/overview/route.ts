import { getStockToken, parseKlines } from "@stockx/shared";
import { binancePublic, PUBLIC_PATHS } from "../../../../lib/binance-public";

export const dynamic = "force-dynamic";

const ICON_HOST = "https://bin.bnbstatic.com";
const META_TTL = 6 * 60 * 60_000;
const SPARK_TTL = 2 * 60_000;
const MAX_TOKENS = 12;
const PARALLEL = 4;

interface Entry { icon: string | null; changePct: number | null; spark: number[] }
const metaCache = new Map<string, { t: number; icon: string | null }>();
const sparkCache = new Map<string, { t: number; changePct: number | null; spark: number[] }>();

async function icon(address: string): Promise<string | null> {
  const hit = metaCache.get(address);
  if (hit && Date.now() - hit.t < META_TTL) return hit.icon;
  const meta = await binancePublic<{ icon?: unknown }>(PUBLIC_PATHS.meta, { chainId: 56, contractAddress: address });
  const path = typeof meta?.icon === "string" ? meta.icon : null;
  const url = path && path.startsWith("/") ? `${ICON_HOST}${path}` : null; // only our known image host
  metaCache.set(address, { t: Date.now(), icon: url });
  return url;
}

async function spark(address: string): Promise<{ changePct: number | null; spark: number[] }> {
  const hit = sparkCache.get(address);
  if (hit && Date.now() - hit.t < SPARK_TTL) return hit;
  const data = await binancePublic<{ klineInfos?: unknown }>(PUBLIC_PATHS.kline, {
    chainId: 56, contractAddress: address, interval: "30m", limit: 48,
  });
  const series = parseKlines(data?.klineInfos, "1D");
  const value = { t: Date.now(), changePct: series ? series.changePct : null, spark: series ? series.points.map((p) => p.c) : [] };
  sparkCache.set(address, value);
  return value;
}

/** GET /api/rwa/overview?tokens=AAPLB,ADBEB  Logo, 24h change and a 24h sparkline per token (max 12). */
export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("tokens") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, MAX_TOKENS);
  const tokens = symbols.map((s) => getStockToken(s)).filter((t): t is NonNullable<typeof t> => !!t);
  if (tokens.length === 0) return Response.json({ error: "No known tokens" }, { status: 400 });

  const out: Record<string, Entry> = {};
  for (let i = 0; i < tokens.length; i += PARALLEL) {
    await Promise.all(tokens.slice(i, i + PARALLEL).map(async (t) => {
      const [ic, sp] = await Promise.allSettled([icon(t.address), spark(t.address)]);
      const s = sp.status === "fulfilled" ? sp.value : { changePct: null, spark: [] as number[] };
      out[t.symbol] = { icon: ic.status === "fulfilled" ? ic.value : null, changePct: s.changePct, spark: s.spark };
    }));
  }
  return Response.json(out, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
