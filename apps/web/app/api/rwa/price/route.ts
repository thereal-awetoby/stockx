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

export async function GET(req: Request) {
  const token = (new URL(req.url).searchParams.get("token") ?? "").toLowerCase();
  // Only proxy tokens we list. This route must not become an open relay to Binance.
  if (!STOCKS.some((s) => s.address === token)) {
    return Response.json({ error: "Unknown token" }, { status: 400 });
  }
  try {
    const rows = await binanceGet<RwaPriceRow[]>("/api/v1/dex/market/rwa/price", {
      binanceChainId: "56",
      tokenContractAddresses: token,
    });
    const row = rows.find((r) => r.tokenContractAddress.toLowerCase() === token);
    if (!row) return Response.json({ error: "No price returned for this token" }, { status: 404 });
    return Response.json({
      tokenPrice: Number(row.tokenPrice),
      referencePrice: Number(row.referencePrice),
      updatedAt: row.tokenPriceUpdatedAt,
    });
  } catch (e) {
    // The signed endpoint can refuse (for example "compliance restriction" for the server's location).
    // Prices are public data, so fall back to Binance's public endpoint instead of showing dashes.
    try {
      const data = await binancePublic<unknown>(PUBLIC_PATHS.dynamic, { chainId: 56, contractAddress: token });
      const p = priceFromDynamic(data);
      if (p) return Response.json({ tokenPrice: p.tokenPrice, referencePrice: p.referencePrice, updatedAt: Date.now(), source: "binance-public" });
    } catch {
      /* fall through to the original error */
    }
    return errorResponse(e);
  }
}