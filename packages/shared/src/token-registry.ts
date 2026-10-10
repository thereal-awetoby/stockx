import { REGISTRY_ROWS, type RegistryRow } from "./token-registry.data";
import { TOKENS } from "./tokens";

/**
 * Which stock tokens exist (generated, from Binance RWA search) versus which are TRADABLE.
 *
 * A token is tradable only if the owner has bought a few cents of it through the app and
 * checked the result on BscScan. Add its symbol to VERIFIED_LIVE_SYMBOLS after that.
 * To test one before committing, set NEXT_PUBLIC_EXTRA_LIVE=NVDAB,TSLAB in apps/web/.env.local
 * (symbols that are not in the registry are ignored, so a typo cannot enable anything).
 */
export const VERIFIED_LIVE_SYMBOLS: readonly string[] = ["AAPLB"];

/** Read on every call (cheap, memoised) so tests can flip it; Next inlines the literal at build time. */
const readExtraLive = (): string | undefined =>
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_EXTRA_LIVE?.trim() : undefined;

export type StockToken = RegistryRow;

const bySymbol = new Map<string, StockToken>(REGISTRY_ROWS.map((r) => [r.symbol, r]));
const byAddress = new Map<string, StockToken>(REGISTRY_ROWS.map((r) => [r.address.toLowerCase(), r]));

function buildLiveSet(extra: string | undefined): Set<string> {
  const live = new Set<string>();
  const wanted = [...VERIFIED_LIVE_SYMBOLS, ...(extra ? extra.split(",") : [])];
  for (const raw of wanted) {
    const sym = raw.trim().toUpperCase();
    if (sym && bySymbol.has(sym)) live.add(sym);
  }
  return live;
}

let cache: { raw: string | undefined; set: Set<string> } | null = null;
function liveSet(): ReadonlySet<string> {
  const raw = readExtraLive();
  if (!cache || cache.raw !== raw) cache = { raw, set: buildLiveSet(raw) };
  return cache.set;
}

/** Test hook: the live set for an explicit EXTRA_LIVE string. */
export const liveSymbolsFor = (extra?: string): ReadonlySet<string> => buildLiveSet(extra);

export const listStockTokens = (): readonly StockToken[] => REGISTRY_ROWS;
export const getStockToken = (symbol: string): StockToken | undefined => bySymbol.get(symbol);
export const getStockTokenByAddress = (address: string): StockToken | undefined => byAddress.get(address.toLowerCase());
export const isLiveSymbol = (symbol: string): boolean => liveSet().has(symbol);
export const listLiveStockTokens = (): StockToken[] => REGISTRY_ROWS.filter((r) => liveSet().has(r.symbol));

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
