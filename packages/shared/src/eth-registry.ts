import type { DexToken } from "./dex-provider";
import { ETH_ROWS } from "./eth-registry.data";

export interface EthStockToken extends DexToken {
  name: string | null;
  /** A DEX route existed in the scan and lost under 2% at a $2 swap. Only these are tradable. */
  clean: boolean;
}

const ALL: EthStockToken[] = ETH_ROWS.map((r) => ({
  symbol: r.symbol, name: r.name, address: r.address.toLowerCase(), decimals: 18,
  clean: r.lossPct !== null && r.lossPct < 2,
}));
const bySymbol = new Map(ALL.map((t) => [t.symbol, t]));

export const listEthStockTokens = (): EthStockToken[] => ALL.filter((t) => t.clean);
/** Tradable tokens only: a token without a clean route is treated as not available. */
export const getEthTradableToken = (symbol: string): EthStockToken | undefined => {
  const t = bySymbol.get(symbol);
  return t && t.clean ? t : undefined;
};
