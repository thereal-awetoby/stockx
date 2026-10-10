/** Trades made through stockX in THIS browser (not read from the chain). Shown on Portfolio. */
export interface TradeEntry {
  t: number;
  side: "buy" | "sell";
  token: string;
  amountIn: string;
  inSym: string;
  amountOut: string;
  outSym: string;
  txHash: string;
}

const key = (address: string) => `stockx.trades.v1.${address.toLowerCase()}`;
const isEntry = (v: unknown): v is TradeEntry => {
  const e = v as Partial<TradeEntry> | null;
  return !!e && typeof e.t === "number" && (e.side === "buy" || e.side === "sell") && typeof e.txHash === "string" &&
    typeof e.token === "string" && typeof e.amountIn === "string" && typeof e.amountOut === "string" &&
    typeof e.inSym === "string" && typeof e.outSym === "string";
};

export function readTrades(address: string): TradeEntry[] {
  try {
    const raw = localStorage.getItem(key(address));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function recordTrade(address: string, entry: TradeEntry): void {
  try {
    localStorage.setItem(key(address), JSON.stringify([entry, ...readTrades(address)].slice(0, 50)));
  } catch {
    /* storage unavailable: the trade is on-chain either way */
  }
}
