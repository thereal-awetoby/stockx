// SERVER ONLY. Binance sends no US stock price while the US market is closed, so the reference price
// falls back to the stock's last regular-session price from public quote pages (no key needed).
// Yahoo's chart endpoint first, Stooq as a backup. Cached, and a miss is remembered briefly.
const TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 60_000;
const cache = new Map<string, { t: number; v: number | null }>();
const inflight = new Map<string, Promise<number | null>>();

const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

async function yahoo(symbol: string): Promise<number | null> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; stockX)", Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { chart?: { result?: { meta?: { regularMarketPrice?: unknown } }[] } } | null;
  return positive(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
}

async function stooq(symbol: string): Promise<number | null> {
  const res = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&f=sc&h&e=csv`, {
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) return null;
  const row = (await res.text()).trim().split(/\r?\n/)[1]?.split(",");
  const v = Number(row?.[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Last regular-session price of a US ticker in USD, or null if no source answered. */
export function lastStockPrice(ticker: string): Promise<number | null> {
  const symbol = ticker.trim().toUpperCase().replace(/\./g, "-");
  if (!/^[A-Z0-9-]{1,10}$/.test(symbol)) return Promise.resolve(null);
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.t < (hit.v === null ? MISS_TTL_MS : TTL_MS)) return Promise.resolve(hit.v);
  const pending = inflight.get(symbol);
  if (pending) return pending;
  const p = (async () => {
    let v: number | null = null;
    try { v = await yahoo(symbol); } catch { /* try the backup */ }
    if (v === null) { try { v = await stooq(symbol); } catch { /* no price */ } }
    cache.set(symbol, { t: Date.now(), v });
    return v;
  })().finally(() => { inflight.delete(symbol); });
  inflight.set(symbol, p);
  return p;
}
