import { getStockToken, KLINE_RANGES, parseKlines, type KlineRange } from "@stockx/shared";
import { binancePublic, PUBLIC_PATHS } from "../../../../lib/binance-public";

export const dynamic = "force-dynamic";

const ICON_HOST = "https://bin.bnbstatic.com";
const META_TTL = 6 * 60 * 60_000;
const SPARK_TTL = 2 * 60_000;
const MAX_TOKENS = 12;
const PARALLEL = 2;

interface Entry { icon: string | null; changePct: number | null; spark: number[] }
const metaCache = new Map<string, { t: number; icon: string | null }>();
const changeCache = new Map<string, { t: number; v: number | null }>();
const sparkCache = new Map<string, { t: number; changePct: number | null; spark: number[] }>();

/** One quick retry: Binance's public endpoints sometimes fail for a single call under load. */
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch { await new Promise((r) => setTimeout(r, 400)); return fn(); }
}

async function icon(address: string): Promise<string | null> {
  const hit = metaCache.get(address);
  if (hit && Date.now() - hit.t < META_TTL) return hit.icon;
  const meta = await retry(() => binancePublic<{ icon?: unknown }>(PUBLIC_PATHS.meta, { chainId: 56, contractAddress: address }));
  const path = typeof meta?.icon === "string" ? meta.icon : null;
  const url = path && path.startsWith("/") ? `${ICON_HOST}${path}` : null; // only our known image host
  metaCache.set(address, { t: Date.now(), icon: url });
  return url;
}

/** Binance's own 24h price change for the token (percent), the same number the stock page shows. */
async function officialChange(address: string): Promise<number | null> {
  const hit = changeCache.get(address);
  if (hit && Date.now() - hit.t < SPARK_TTL) return hit.v;
  const data = await retry(() => binancePublic<{ tokenInfo?: { priceChangePct24h?: unknown } }>(PUBLIC_PATHS.dynamic, { chainId: 56, contractAddress: address }));
  const raw = data?.tokenInfo?.priceChangePct24h;
  const v = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
  const out = Number.isFinite(v) ? v : null;
  changeCache.set(address, { t: Date.now(), v: out });
  return out;
}

async function spark(address: string): Promise<{ changePct: number | null; spark: number[] }> {
  const hit = sparkCache.get(address);
  if (hit && Date.now() - hit.t < SPARK_TTL) return hit;
  // A thinly traded token may have no candles in the last 24h. Widen the window (a week, then a month) so
  // every row still gets a real chart instead of a dash.
  let series = null as ReturnType<typeof parseKlines>;
  const attempts: { interval: string; limit: number; range: KlineRange }[] = [
    { interval: "30m", limit: 48, range: "1D" },
    { interval: KLINE_RANGES["1W"].interval, limit: KLINE_RANGES["1W"].limit, range: "1W" },
    { interval: KLINE_RANGES["1M"].interval, limit: KLINE_RANGES["1M"].limit, range: "1M" },
  ];
  for (const a of attempts) {
    try {
      const data = await retry(() => binancePublic<{ klineInfos?: unknown }>(PUBLIC_PATHS.kline, { chainId: 56, contractAddress: address, interval: a.interval, limit: a.limit }));
      series = parseKlines(data?.klineInfos, a.range);
    } catch { series = null; }
    if (series) break;
  }
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
      const [sp, ch] = await Promise.allSettled([spark(t.address), officialChange(t.address)]);
      const s = sp.status === "fulfilled" ? sp.value : { changePct: null, spark: [] as number[] };
      // Prefer Binance's reported 24h change; fall back to the real last-24h candles; never to stale ones.
      const changePct = ch.status === "fulfilled" && ch.value !== null ? ch.value : s.changePct;
      // Binance token icons carry a Binance mark, so logos come from /api/logo instead and the icon is never sent.
      out[t.symbol] = { icon: null, changePct, spark: s.spark };
    }));
  }
  // Do not let a CDN or the browser keep a response that is missing charts.
  const complete = tokens.every((t) => (out[t.symbol]?.spark.length ?? 0) > 1);
  return Response.json(out, { headers: { "Cache-Control": complete ? "public, s-maxage=60, stale-while-revalidate=120" : "no-store" } });
}
