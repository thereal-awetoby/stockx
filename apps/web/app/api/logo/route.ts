import { listStockTokens, logoDomain, simpleIconUrl } from "@stockx/shared";

export const dynamic = "force-dynamic";

const OK_TYPES = /^image\/(svg\+xml|png|jpeg|webp|x-icon|vnd\.microsoft\.icon|gif)/i;
const MAX_BYTES = 300_000;

async function grab(url: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; stockX)" } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!OK_TYPES.test(type)) return null;
    const body = await res.arrayBuffer();
    return body.byteLength > 0 && body.byteLength <= MAX_BYTES ? { body, type: type.split(";")[0]! } : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/logo?ticker=AAPL  The company's own logo (never a Binance or chain icon).
 * Same-origin and cached for a month by the CDN, so the browser never depends on a third-party image host.
 */
export async function GET(req: Request) {
  const ticker = (new URL(req.url).searchParams.get("ticker") ?? "").trim().toUpperCase();
  // Only tickers in our registry: this route must not become an open image proxy.
  if (!listStockTokens().some((t) => t.ticker === ticker)) return new Response("Unknown ticker", { status: 404 });

  const icon = simpleIconUrl(ticker);
  const domain = logoDomain(ticker);
  const found =
    (icon ? await grab(icon) : null) ??
    (domain ? await grab(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`) : null);
  if (!found) return new Response("No logo", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  return new Response(found.body, {
    headers: {
      "Content-Type": found.type,
      "Cache-Control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400",
    },
  });
}
