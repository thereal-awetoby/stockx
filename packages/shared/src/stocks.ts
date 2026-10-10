import { isLiveSymbol, listStockTokens } from "./token-registry";
import type { QuoteStyle } from "./types";

export interface Stock {
  slug: string;
  ticker: string;
  name: string;
  token: string;
  issuer: string;
  style: QuoteStyle;
  /** Undefined until the contract is verified. Never guess an address. */
  address?: string;
  status: "live" | "soon";
  /** Shown on greyed-out rows. */
  note?: string;
}

const bySlug = (x: Stock, y: Stock) =>
  Number(y.status === "live") - Number(x.status === "live") || x.ticker.localeCompare(y.ticker);

/** Every registry token. "live" only if it is on the verified/live list; the rest show as "soon". */
export const STOCKS: Stock[] = listStockTokens()
  .map<Stock>((t) => ({
    slug: t.symbol.toLowerCase(),
    ticker: t.ticker,
    name: t.name,
    token: t.symbol,
    issuer: "bStocks",
    style: "swap",
    address: t.address,
    status: isLiveSymbol(t.symbol) ? "live" : "soon",
    note: isLiveSymbol(t.symbol) ? undefined : "Quotes fine on Binance. Trading opens after a live test.",
  }))
  .sort(bySlug);

export const getStock = (slug: string) => STOCKS.find((s) => s.slug === slug);

export function searchStocks(q: string): Stock[] {
  const n = q.trim().toLowerCase();
  if (!n) return STOCKS;
  return STOCKS.filter((s) =>
    [s.ticker, s.name, s.token, s.issuer].some((f) => f.toLowerCase().includes(n)),
  );
}