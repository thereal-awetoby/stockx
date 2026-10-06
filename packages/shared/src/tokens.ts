/** Token registry for BSC mainnet (chain 56). Lowercase addresses on purpose. */
export const TOKENS = {
    USDT: {
      symbol: "USDT",
      address: "0x55d398326f99059ff775485246999027b3197955",
      decimals: 18,
    },
    AAPLx: {
      symbol: "AAPLx",
      ticker: "AAPL",
      name: "Apple xStock",
      issuer: "xStocks",
      style: "swap",
      // BscScan: "Apple xStock (AAPLx)", BackedTokenProxy. Always use this PROXY address.
      address: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a",
      decimals: 18, // confirm with: node scripts/check-tokens.mjs
    },
  } as const;
  
  export type TokenSymbol = keyof typeof TOKENS;