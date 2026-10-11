import { classifyTrade, type DecodedTransfer, type TokenMeta } from "./trade-import";
import type { TradeEntry } from "./trade-log";

/** One row of the explorer's ERC-20 transfer list (`module=account&action=tokentx`). */
export interface TokenTxRow { hash: string; from: string; to: string; value: string; contractAddress: string; timeStamp: string }

/**
 * Turns an address's explorer token-transfer history into trades. Rows are grouped by transaction hash and
 * each group is classified by the owner's net transfers, so only real stock buys and sells come out.
 */
export function tradesFromTokenTx(owner: string, rows: TokenTxRow[], tokens: TokenMeta[]): TradeEntry[] {
  const byHash = new Map<string, TokenTxRow[]>();
  for (const r of rows) {
    if (!r || typeof r.hash !== "string" || !/^\d+$/.test(r.value ?? "")) continue;
    const g = byHash.get(r.hash);
    if (g) g.push(r); else byHash.set(r.hash, [r]);
  }
  const out: TradeEntry[] = [];
  for (const [hash, group] of byHash) {
    const transfers: DecodedTransfer[] = group.map((r) => ({ token: r.contractAddress, from: r.from, to: r.to, value: BigInt(r.value) }));
    const c = classifyTrade(owner, transfers, tokens);
    if (c) out.push({ ...c, t: Number(group[0]!.timeStamp) * 1000, txHash: hash });
  }
  return out.sort((a, b) => b.t - a.t);
}
