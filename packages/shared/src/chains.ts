import { TOKENS } from "./tokens";

export type ChainKey = "bsc" | "ethereum";

export interface CashToken { symbol: string; address: string; decimals: number }

export interface ChainInfo {
  key: ChainKey;
  id: number;
  name: string;
  native: string;
  explorer: string;
  /** The stablecoin people pay with on this chain. */
  cash: CashToken;
  /** Who quotes and builds swaps on this chain. */
  source: "binance" | "dex";
}

export const CHAINS: Record<ChainKey, ChainInfo> = {
  bsc: {
    key: "bsc", id: 56, name: "BNB Chain", native: "BNB", explorer: "https://bscscan.com",
    cash: { symbol: TOKENS.USDT.symbol, address: TOKENS.USDT.address, decimals: TOKENS.USDT.decimals },
    source: "binance",
  },
  ethereum: {
    key: "ethereum", id: 1, name: "Ethereum", native: "ETH", explorer: "https://etherscan.io",
    cash: { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
    source: "dex",
  },
};

export const chainById = (id: number): ChainInfo | undefined => Object.values(CHAINS).find((c) => c.id === id);
