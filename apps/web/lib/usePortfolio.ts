"use client";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { listLiveStockTokens, TOKENS } from "@stockx/shared";
import { getPriceCached } from "./price-queue";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export interface Tracked { symbol: string; name: string; address: Address; decimals: number }
export const TRACKED: Tracked[] = [
  { symbol: "USDT", name: "Tether", address: TOKENS.USDT.address, decimals: TOKENS.USDT.decimals },
  ...listLiveStockTokens().map((t) => ({ symbol: t.symbol, name: t.name, address: t.address as Address, decimals: t.decimals })),
];

/** Balances (one multicall) and live prices for the connected wallet. Shared by Portfolio and the home panel. */
export function usePortfolio() {
  const { address, isConnected } = useAccount();
  const bnb = useBalance({ address, chainId: 56, query: { enabled: !!address, refetchInterval: 20_000 } });
  const balances = useReadContracts({
    contracts: TRACKED.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ZERO], chainId: 56 }) as const),
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const [stockPrice, setStockPrice] = useState<Record<string, number>>({});

  const rows = TRACKED.map((t, i) => {
    const r = balances.data?.[i];
    const qty = r && r.status === "success" ? Number(formatUnits(r.result as bigint, t.decimals)) : null;
    return { ...t, qty };
  });
  const cash = rows.find((r) => r.symbol === "USDT")?.qty ?? 0;
  const heldStocks = rows.filter((r) => r.symbol !== "USDT" && (r.qty ?? 0) > 0);
  const heldKey = heldStocks.map((r) => r.address).join(",");

  // Prices are only fetched for stock tokens the wallet actually holds.
  useEffect(() => {
    if (!heldKey) { setStockPrice({}); return; }
    let alive = true;
    const load = async () => {
      const out: Record<string, number> = {};
      await Promise.all(heldKey.split(",").map(async (addr) => {
        try { out[addr] = (await getPriceCached(addr)).onchain; } catch { /* price stays unknown */ }
      }));
      if (alive) setStockPrice(out);
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [heldKey]);

  const stocks = heldStocks.reduce((sum, r) => sum + (r.qty ?? 0) * (stockPrice[r.address] ?? 0), 0);
  return { address, isConnected, bnb, balances, rows, cash, heldStocks, stockPrice, stocks, total: cash + stocks };
}
