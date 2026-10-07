import { STOCKS } from "@stockx/shared";
import { binanceGet, errorResponse } from "../../../../lib/binance";

export const dynamic = "force-dynamic";

interface UnderlyingMarket {
  statusInfo: {
    openState: boolean;
    reasonCode: string | null;
    reasonMsg: string | null;
    nextOpenTime: string | number | null;
    nextCloseTime: string | number | null;
  };
}

export async function GET(req: Request) {
  const token = (new URL(req.url).searchParams.get("token") ?? "").toLowerCase();
  if (!STOCKS.some((s) => s.address === token)) {
    return Response.json({ error: "Unknown token" }, { status: 400 });
  }
  try {
    const data = await binanceGet<UnderlyingMarket>("/api/v1/dex/market/rwa/underlying-market", {
      binanceChainId: "56",
      tokenContractAddress: token,
    });
    const s = data.statusInfo;
    return Response.json({
      open: s.openState,
      reasonCode: s.reasonCode,
      reasonMsg: s.reasonMsg,
      nextOpenTime: s.nextOpenTime,
      nextCloseTime: s.nextCloseTime,
    });
  } catch (e) {
    return errorResponse(e);
  }
}