import { TOKENS } from "./tokens";
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
  /** "live" = tradable in v1. "soon" = only after AAPLx buy/sell works. */
  status: "live" | "soon";
}

export const STOCKS: Stock[] = [
  {
    slug: "aaplx",
    ticker: "AAPL",
    name: "Apple Inc.",
    token: "AAPLx",
    issuer: "xStocks",
    style: "swap",
    address: TOKENS.AAPLx.address,
    status: "live",
  },
  {
    slug: "aaplb",
    ticker: "AAPL",
    name: "Apple Inc.",
    token: "AAPLB",
    issuer: "bStocks",
    style: "rfq",
    status: "soon",
  },
];

export const getStock = (slug: string) => STOCKS.find((s) => s.slug === slug);

export function searchStocks(q: string): Stock[] {
  const n = q.trim().toLowerCase();
  if (!n) return STOCKS;
  return STOCKS.filter((s) =>
    [s.ticker, s.name, s.token, s.issuer].some((f) => f.toLowerCase().includes(n)),
  );
}