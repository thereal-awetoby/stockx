import { REGISTRY_ROWS, type RegistryRow } from "./token-registry.data";
import { TOKENS } from "./tokens";

/**
 * Which stock tokens exist (generated from the Binance RWA search) and which are TRADABLE.
 *
 * Every registry token is tradable. Each trade is protected at run time: the quote must be for the
 * registry address and decimals, flagged honeypots and taxed tokens are refused (assertTokenSafety), and
 * every swap is simulated first with a minimum-received floor.
 *
 * To pull a token back (it breaks, or its liquidity dries up) add its symbol to DISABLED_SYMBOLS, or set
 * NEXT_PUBLIC_DISABLED_TOKENS=NVDAB,TSLAB. A disabled token disappears from the app and is refused by the
 * server and the agent. Symbols that are not in the registry are ignored.
 */
export const DISABLED_SYMBOLS: readonly string[] = [];

/** Tokens the owner has bought for real and checked on BscScan. Informational only: it does not gate trading. */
export const VERIFIED_LIVE_SYMBOLS: readonly string[] = ["AAPLB"];

/** Read on every call (cheap, memoised) so tests can flip it; Next inlines the literal at build time. */
const readDisabled = (): string | undefined =>
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_DISABLED_TOKENS?.trim() : undefined;

export type StockToken = RegistryRow;

const bySymbol = new Map<string, StockToken>(REGISTRY_ROWS.map((r) => [r.symbol, r]));
const byAddress = new Map<string, StockToken>(REGISTRY_ROWS.map((r) => [r.address.toLowerCase(), r]));

function buildDisabledSet(extra: string | undefined): Set<string> {
  const off = new Set<string>();
  for (const raw of [...DISABLED_SYMBOLS, ...(extra ? extra.split(",") : [])]) {
    const sym = raw.trim().toUpperCase();
    if (sym && bySymbol.has(sym)) off.add(sym);
  }
  return off;
}

let cache: { raw: string | undefined; set: Set<string> } | null = null;
function disabledSet(): ReadonlySet<string> {
  const raw = readDisabled();
  if (!cache || cache.raw !== raw) cache = { raw, set: buildDisabledSet(raw) };
  return cache.set;
}

/** Test hook: the disabled set for an explicit NEXT_PUBLIC_DISABLED_TOKENS string. */
export const disabledSymbolsFor = (extra?: string): ReadonlySet<string> => buildDisabledSet(extra);

export const listStockTokens = (): readonly StockToken[] => REGISTRY_ROWS;
export const getStockToken = (symbol: string): StockToken | undefined => bySymbol.get(symbol);
export const getStockTokenByAddress = (address: string): StockToken | undefined => byAddress.get(address.toLowerCase());
export const isLiveSymbol = (symbol: string): boolean => bySymbol.has(symbol) && !disabledSet().has(symbol);
export const listLiveStockTokens = (): StockToken[] => REGISTRY_ROWS.filter((r) => !disabledSet().has(r.symbol));

export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
}

/** USDT or any registry stock token. Unknown symbols return undefined, never a guess. */
export function getTokenInfo(symbol: string): TokenInfo | undefined {
  if (symbol === "USDT") return TOKENS.USDT;
  return bySymbol.get(symbol);
}
