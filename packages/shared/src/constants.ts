export const CHAIN_ID = 56; // BSC mainnet
export const RFQ_TTL_MS = 30_000;

/** BSC-USD (Tether) on BNB Chain. */
export const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955" as const;

export const FIRST_STOCK = {
  ticker: "AAPL",
  name: "Apple Inc.",
  token: "AAPLB",
  issuer: "bStocks",
  style: "swap" as const,
};
