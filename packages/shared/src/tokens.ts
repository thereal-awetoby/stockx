/** Token registry for BSC mainnet (chain 56). Lowercase addresses on purpose. */
export const TOKENS = {
  USDT: {
    symbol: "USDT",
    address: "0x55d398326f99059ff775485246999027b3197955",
    decimals: 18,
  },
  AAPLB: {
    symbol: "AAPLB",
    ticker: "AAPL",
    name: "Apple bStock",
    issuer: "bStocks",
    platformId: "bstock", // Binance RWA Data API platform id
    style: "swap", // quote says executionMode SWAP; the helper still enforces RFQ expiry if it appears
    address: "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a", // from Binance RWA search
    decimals: 18, // from the quote response; also check with scripts/check-tokens.mjs
  },
} as const;

export type TokenSymbol = keyof typeof TOKENS;