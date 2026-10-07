import { STOCKS } from "@stockx/shared";
import { binanceGet, errorResponse } from "../../../../lib/binance";

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
    return errorResponse(e);
  }
}