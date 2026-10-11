export const dynamic = "force-dynamic";

const TTL_MS = 20_000;
let cache: { t: number; price: number } | null = null;

/** GET /api/bnb-price  Spot BNB/USDT price from Binance's public ticker endpoint (no key needed), cached 20s. */
export async function GET() {
  if (cache && Date.now() - cache.t < TTL_MS) return Response.json({ price: cache.price });
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { price?: string } | null;
    const price = json?.price ? Number(json.price) : null;
    if (!price || !Number.isFinite(price)) throw new Error("bad price");
    cache = { t: Date.now(), price };
    return Response.json({ price }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" } });
  } catch {
    return Response.json({ error: "BNB price unavailable" }, { status: 502 });
  }
}
