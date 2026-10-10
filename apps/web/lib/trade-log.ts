/** Trades made through stockX (wallet and agent) in THIS browser. Shown on Portfolio. */
export interface TradeEntry {
  t: number;
  side: "buy" | "sell";
  token: string;
  amountIn: string;
  inSym: string;
  /** Empty when unknown (agent records only know what was spent). */
  amountOut: string;
  outSym: string;
  txHash: string;
  via?: "agent";
}

const EVENT = "stockx:trades";
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

/** Every address given (main wallet, pocket), merged, newest first, no duplicate hashes. */
export function readTradesFor(addresses: string[]): TradeEntry[] {
  const seen = new Set<string>();
  const all: TradeEntry[] = [];
  for (const a of addresses) for (const t of readTrades(a)) {
    const k = t.txHash.toLowerCase();
    if (!seen.has(k)) { seen.add(k); all.push(t); }
  }
  return all.sort((a, b) => b.t - a.t).slice(0, 50);
}

export function recordTrade(address: string, entry: TradeEntry): void {
  try {
    const existing = readTrades(address);
    if (existing.some((e) => e.txHash.toLowerCase() === entry.txHash.toLowerCase())) return;
    localStorage.setItem(key(address), JSON.stringify([entry, ...existing].slice(0, 50)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable: the trade is on-chain either way */
  }
}

/** Calls back whenever a trade is recorded (this tab or another). */
export function subscribeTrades(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}
