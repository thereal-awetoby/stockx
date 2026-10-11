import { priceFromDynamic, STOCKS } from "@stockx/shared";
import { binanceGet, errorResponse } from "../../../../lib/binance";
import { binancePublic, PUBLIC_PATHS } from "../../../../lib/binance-public";

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
  return p ? { tokenPrice: p.tokenPrice, referencePrice: p.referencePrice, updatedAt: Date.now(), source: "binance-public" } : null;
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
