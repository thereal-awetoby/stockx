import { getStockToken } from "@stockx/shared";
import { binancePublic, PUBLIC_PATHS } from "../../../../lib/binance-public";

export const dynamic = "force-dynamic";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

const RPCS = ["https://bsc-dataseed.binance.org", "https://bsc-dataseed1.defibit.io", "https://bsc-rpc.publicnode.com"];

/** totalSupply() of the token contract straight from BNB Chain, in whole tokens. Used when Binance leaves supply blank. */
async function onChainSupply(address: string, decimals: number): Promise<number | null> {
  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: address, data: "0x18160ddd" }, "latest"] }),
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
      const j = (await res.json()) as { result?: string };
      if (typeof j.result === "string" && /^0x[0-9a-fA-F]+$/.test(j.result)) return Number(BigInt(j.result)) / 10 ** decimals;
    } catch { /* next RPC */ }
  }
  return null;
}
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** GET /api/rwa/info?token=AAPLB  Company text plus on-chain and stock statistics. Missing pieces come back as null. */
export async function GET(req: Request) {
  const token = getStockToken((new URL(req.url).searchParams.get("token") ?? "").toUpperCase());
  if (!token) return Response.json({ error: "Unknown token" }, { status: 400 });

  const params = { chainId: 56, contractAddress: token.address };
  const [meta, dyn] = await Promise.allSettled([
    binancePublic<Obj>(PUBLIC_PATHS.meta, params),
    binancePublic<Obj>(PUBLIC_PATHS.dynamic, params),
  ]);
  if (meta.status === "rejected" && dyn.status === "rejected") {
    return Response.json({ error: "Company data is unavailable right now" }, { status: 502 });
  }

  const company = obj(obj(meta.status === "fulfilled" ? meta.value : null).companyInfo);
  const d = dyn.status === "fulfilled" ? obj(dyn.value) : {};
  const t = obj(d.tokenInfo);
  const s = obj(d.stockInfo);

  // Supply and market cap: Binance's number when it has one, otherwise read from the chain.
  let circulating = str(t.circulatingSupply);
  let marketCap = str(t.marketCap);
  if (circulating === null || Number(circulating) <= 0) {
    const supply = await onChainSupply(token.address, token.decimals);
    if (supply !== null && supply > 0) {
      circulating = String(supply);
      const price = Number(str(t.price));
      if ((marketCap === null || Number(marketCap) <= 0) && Number.isFinite(price) && price > 0) marketCap = String(supply * price);
    }
  }

  return Response.json(
    {
      description: str(company.description),
      ceo: str(company.ceo),
      industry: str(company.industry),
      concepts: strs(company.conceptsEn),
      holders: str(t.totalHolders),
      priceChangePct24h: str(t.priceChangePct24h),
      marketCap,
      circulatingSupply: circulating,
      sharesMultiplier: str(t.sharesMultiplier),
      high52w: str(s.priceHigh52w),
      low52w: str(s.priceLow52w),
      pe: str(s.priceToEarnings),
      dividendYield: str(s.dividendYield),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
