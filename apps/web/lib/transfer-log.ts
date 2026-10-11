/** Funding and withdrawals between the main wallet and the pocket, made through stockX in THIS browser. */
export interface TransferEntry {
  t: number;
  kind: "fund" | "withdraw";
  asset: string;
  amount: string;
  txHash: string;
}

const key = (address: string) => `stockx.transfers.v1.${address.toLowerCase()}`;
const isEntry = (v: unknown): v is TransferEntry => {
  const e = v as Partial<TransferEntry> | null;
  return !!e && typeof e.t === "number" && (e.kind === "fund" || e.kind === "withdraw") &&
    typeof e.asset === "string" && typeof e.amount === "string" && typeof e.txHash === "string";
};

export function readTransfers(address: string): TransferEntry[] {
  try {
    const raw = localStorage.getItem(key(address));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, 50) : [];
  } catch {
    return [];
  }
}

/** Returns the updated list (newest first). Storage problems never matter: the transfer is on-chain either way. */
export function recordTransfer(address: string, entry: TransferEntry): TransferEntry[] {
  const existing = readTransfers(address);
  if (existing.some((e) => e.txHash.toLowerCase() === entry.txHash.toLowerCase())) return existing;
  const next = [entry, ...existing].slice(0, 50);
  try { localStorage.setItem(key(address), JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
