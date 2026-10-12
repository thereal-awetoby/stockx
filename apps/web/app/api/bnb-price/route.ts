export const dynamic = "force-dynamic";

const TTL_MS = 20_000;
const cache: Record<string, { t: number; price: number }> = {};
const PAIRS: Record<string, string> = { BNB: "BNBUSDT", ETH: "ETHUSDT" };

/** GET /api/bnb-price  Spot BNB/USDT price from Binance's public ticker endpoint (no key needed), cached 20s. */
export async function GET(req: Request) {
  const sym = (new URL(req.url).searchParams.get("symbol") ?? "BNB").toUpperCase();
  const pair = PAIRS[sym];
  if (!pair) return Response.json({ error: "Unknown symbol" }, { status: 400 });
  const hit = cache[sym];
  if (hit && Date.now() - hit.t < TTL_MS) return Response.json({ price: hit.price });
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { price?: string } | null;
    const price = json?.price ? Number(json.price) : null;
    if (!price || !Number.isFinite(price)) throw new Error("bad price");
    cache[sym] = { t: Date.now(), price };
    return Response.json({ price }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" } });
  } catch {
    return Response.json({ error: `${sym} price unavailable` }, { status: 502 });
  }
}
