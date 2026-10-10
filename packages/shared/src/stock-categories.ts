/**
 * Sector filters for Explore. This is OUR classification of the underlying companies (not data from
 * Binance). A ticker that is not listed here still shows under "All assets".
 */
export const STOCK_CATEGORIES = [
  "ETF",
  "Technology",
  "Communication",
  "Consumer",
  "Financials",
  "Healthcare",
  "Industrials & energy",
] as const;

export type StockCategory = (typeof STOCK_CATEGORIES)[number];

const group = (category: StockCategory, tickers: string): [string, StockCategory][] =>
  tickers.split(/\s+/).filter(Boolean).map((t) => [t, category]);

const BY_TICKER: Record<string, StockCategory> = Object.fromEntries([
  ...group("ETF", "EWY QQQ SPY"),
  ...group("Technology", "AAPL ADBE AMAT AMD ARM ASML AVGO CRDO CRM CRWD CRWV DELL GLW IBM INTC LITE MRVL MSFT MU NBIS NVDA ORCL PLTR QCOM SHAZ SKHY SMCI STX TSM WDC ZM"),
  ...group("Communication", "ASTS DJT GOOGL META NFLX RDDT"),
  ...group("Consumer", "AMC AMZN BABA GME TSLA WEN"),
  ...group("Financials", "COIN CYPH FWDI GS HOOD JPM MSTR PYPL SECZ"),
  ...group("Healthcare", "HIMS LLY"),
  ...group("Industrials & energy", "BE FLNC RKLB SPCX USAR"),
]);

export function categoryOf(ticker: string): StockCategory | null {
  return BY_TICKER[ticker.trim().toUpperCase()] ?? null;
}
