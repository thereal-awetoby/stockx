import { priceFromDynamic, sharesMultiplierOf, STOCKS } from "@stockx/shared";
import { binanceGet, errorResponse } from "../../../../lib/binance";
import { binancePublic, PUBLIC_PATHS } from "../../../../lib/binance-public";
import { lastStockPrice } from "../../../../lib/stock-quote";

export const dynamic = "force-dynamic";

interface RwaPriceRow {
  tokenContractAddress: string;
  tokenPrice: string;
  referencePrice: string;
  tokenPriceUpdatedAt: number;
}
interface PriceBody { tokenPrice: number; referencePrice: number | null; updatedAt: number; source: string }

// Tiny per-server cache so 60 table rows do not hammer Binance.
const cache = new Map<string, { at: number; body: PriceBody }>();
const TTL_MS = 10_000;

/** Public endpoint: no key, no region check on our side, works without any wallet. */
async function fromPublic(token: string): Promise<PriceBody | null> {
  const data = await binancePublic<unknown>(PUBLIC_PATHS.dynamic, { chainId: 56, contractAddress: token });
  const p = priceFromDynamic(data);
  if (!p) return null;
  if (p.referencePrice !== null) return { tokenPrice: p.tokenPrice, referencePrice: p.referencePrice, updatedAt: Date.now(), source: "binance-public" };
  // No live stock price from Binance (US market closed): use the stock's last close, scaled to one token.
  const ticker = STOCKS.find((s) => s.address === token)?.ticker;
  const last = ticker ? await lastStockPrice(ticker) : null;
  return {
    tokenPrice: p.tokenPrice,
    referencePrice: last === null ? null : last * sharesMultiplierOf(data),
    updatedAt: Date.now(),
    source: last === null ? "binance-public" : "binance-public+close",
  };
}

/** Signed endpoint: may refuse (compliance/region) or return no row. Both count as "no answer". */
async function fromSigned(token: string): Promise<PriceBody | null> {
  const rows = await binanceGet<RwaPriceRow[]>("/api/v1/dex/market/rwa/price", {
    binanceChainId: "56",
    tokenContractAddresses: token,
  });
  const row = rows.find((r) => r.tokenContractAddress.toLowerCase() === token);
  if (!row) return null;
  const tokenPrice = Number(row.tokenPrice);
  const ref = Number(row.referencePrice);
  if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) return null;
  return {
    tokenPrice,
    referencePrice: Number.isFinite(ref) && ref > 0 ? ref : null,
    updatedAt: row.tokenPriceUpdatedAt,
    source: "binance-signed",
  };
}

export async function GET(req: Request) {
  const token = (new URL(req.url).searchParams.get("token") ?? "").toLowerCase();
  // Only proxy tokens we list. This route must not become an open relay to Binance.
  if (!STOCKS.some((s) => s.address === token)) {
    return Response.json({ error: "Unknown token" }, { status: 400 });
  }
  if (new URL(req.url).searchParams.get("debug") === "1") {
    // Public Binance data for a listed token, as returned. Lets us see exactly which fields exist.
    try {
      return Response.json(await binancePublic<unknown>(PUBLIC_PATHS.dynamic, { chainId: 56, contractAddress: token }));
    } catch (e) {
      return errorResponse(e);
    }
  }
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.body);

  let lastError: unknown = null;
  for (const source of [fromPublic, fromSigned]) {
    try {
      const body = await source(token);
      if (body) {
        cache.set(token, { at: Date.now(), body });
        return Response.json(body);
      }
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) return errorResponse(lastError);
  return Response.json({ error: "No price returned for this token" }, { status: 404 });
}
