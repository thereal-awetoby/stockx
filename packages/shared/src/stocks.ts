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

const byTicker = (x: Stock, y: Stock) => x.ticker.localeCompare(y.ticker);

/** Every tradable registry token. Tokens pulled back with DISABLED_SYMBOLS are left out entirely. */
export const STOCKS: Stock[] = listStockTokens()
  .filter((t) => isLiveSymbol(t.symbol))
  .map<Stock>((t) => ({
    slug: t.symbol.toLowerCase(),
    ticker: t.ticker,
    name: t.name,
    token: t.symbol,
    issuer: "bStocks",
    style: "swap",
    address: t.address,
    status: "live",
  }))
  .sort(byTicker);

export const getStock = (slug: string) => STOCKS.find((s) => s.slug === slug);

export function searchStocks(q: string): Stock[] {
  const n = q.trim().toLowerCase();
  if (!n) return STOCKS;
  return STOCKS.filter((s) =>
    [s.ticker, s.name, s.token, s.issuer].some((f) => f.toLowerCase().includes(n)),
  );
}