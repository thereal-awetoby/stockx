import { formatUnits, parseEventLogs, erc20Abi, type Hex, type PublicClient } from "viem";
import type { TradeEntry } from "./trade-log";

export interface DecodedTransfer { token: string; from: string; to: string; value: bigint }
export interface TokenMeta { symbol: string; address: string; decimals: number }
export type ClassifiedTrade = Pick<TradeEntry, "side" | "token" | "amountIn" | "inSym" | "amountOut" | "outSym">;

const low = (s: string) => s.toLowerCase();
const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/**
 * Decides whether `owner` bought or sold a stock token in this transaction, from net transfers only.
 * Router and pool hops net out to zero for the owner, so only the owner's real in/out remain.
 * Returns null unless it is exactly one USDT leg against exactly one stock token.
 */
export function classifyTrade(owner: string, transfers: DecodedTransfer[], tokens: TokenMeta[]): ClassifiedTrade | null {
  const bySym = new Map(tokens.map((t) => [low(t.address), t]));
  const net = new Map<string, bigint>();
  for (const tr of transfers) {
    const meta = bySym.get(low(tr.token));
    if (!meta) continue;
    let d = net.get(meta.symbol) ?? 0n;
    if (low(tr.to) === low(owner)) d += tr.value;
    if (low(tr.from) === low(owner)) d -= tr.value;
    net.set(meta.symbol, d);
  }
  const usdt = tokens.find((t) => t.symbol === "USDT");
  const usdtNet = usdt ? net.get("USDT") ?? 0n : 0n;
  const stocks = [...net.entries()].filter(([sym, v]) => sym !== "USDT" && v !== 0n);
  if (!usdt || stocks.length !== 1 || usdtNet === 0n) return null;
  const [sym, v] = stocks[0]!;
  const stock = tokens.find((t) => t.symbol === sym)!;
  if (usdtNet < 0n && v > 0n) {
    return { side: "buy", token: sym, inSym: "USDT", amountIn: trim(formatUnits(-usdtNet, usdt.decimals)), outSym: sym, amountOut: trim(formatUnits(v, stock.decimals)) };
  }
  if (usdtNet > 0n && v < 0n) {
    return { side: "sell", token: sym, inSym: sym, amountIn: trim(formatUnits(-v, stock.decimals)), outSym: "USDT", amountOut: trim(formatUnits(usdtNet, usdt.decimals)) };
  }
  return null;
}

/** Reads a past transaction from the chain so trades made elsewhere (another browser, the agent) can be added. */
export async function importTradeFromHash(
  client: PublicClient,
  hash: Hex,
  owners: string[],
  tokens: TokenMeta[],
): Promise<{ owner: string; entry: TradeEntry } | "failed" | null> {
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") return "failed";
  const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const transfers: DecodedTransfer[] = logs.map((l) => ({ token: l.address, from: l.args.from, to: l.args.to, value: l.args.value }));
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  for (const owner of owners) {
    const c = classifyTrade(owner, transfers, tokens);
    if (c) return { owner, entry: { ...c, t: Number(block.timestamp) * 1000, txHash: hash } };
  }
  return null;
}
