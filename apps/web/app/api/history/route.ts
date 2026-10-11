import { isAddress } from "viem";
import { listStockTokens, TOKENS } from "@stockx/shared";
import { tradesFromTokenTx, type TokenTxRow } from "../../../lib/history";

export const dynamic = "force-dynamic";

/** Stops other websites from spending our explorer quota through a visitor's browser. */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser callers send no Origin
  try {
    return new URL(origin).host === (req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return false;
  }
}

const TOKEN_META = [
  { symbol: "USDT", address: TOKENS.USDT.address as string, decimals: TOKENS.USDT.decimals },
  ...listStockTokens().map((t) => ({ symbol: t.symbol, address: t.address as string, decimals: t.decimals })),
];

/**
 * Reads an address's token transfers from the Etherscan V2 API (the BscScan API), chain 56, and returns the
 * stock buys and sells in them. Needs ETHERSCAN_API_KEY on the server. Without it, or if the plan does not
 * cover BNB Chain, it reports that and the app keeps using its own record plus "add by hash".
 */
export async function GET(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return Response.json({ error: "Invalid address" }, { status: 400 });
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return Response.json({ configured: false, trades: [] });

  const qs = new URLSearchParams({ chainid: "56", module: "account", action: "tokentx", address, page: "1", offset: "300", sort: "desc", apikey: key });
  try {
    const res = await fetch(`https://api.etherscan.io/v2/api?${qs.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const json = (await res.json()) as { status?: string; message?: string; result?: unknown };
    if (json.status === "1" && Array.isArray(json.result)) {
      return Response.json({ configured: true, trades: tradesFromTokenTx(address, json.result as TokenTxRow[], TOKEN_META) });
    }
    if (typeof json.message === "string" && /no transactions found/i.test(json.message)) return Response.json({ configured: true, trades: [] });
    return Response.json({ configured: true, trades: [], error: String(json.result ?? json.message ?? "Explorer error").slice(0, 200) });
  } catch {
    return Response.json({ configured: true, trades: [], error: "Explorer did not respond." });
  }
}
