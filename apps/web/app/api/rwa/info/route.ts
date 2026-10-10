import { getStockToken } from "@stockx/shared";
import { binancePublic, PUBLIC_PATHS } from "../../../../lib/binance-public";

export const dynamic = "force-dynamic";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
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

  return Response.json(
    {
      description: str(company.description),
      ceo: str(company.ceo),
      industry: str(company.industry),
      concepts: strs(company.conceptsEn),
      holders: str(t.totalHolders),
      priceChangePct24h: str(t.priceChangePct24h),
      marketCap: str(t.marketCap),
      circulatingSupply: str(t.circulatingSupply),
      sharesMultiplier: str(t.sharesMultiplier),
      high52w: str(s.priceHigh52w),
      low52w: str(s.priceLow52w),
      pe: str(s.priceToEarnings),
      dividendYield: str(s.dividendYield),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
