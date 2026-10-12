"use client";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { CHAINS, listEthStockTokens, listLiveStockTokens, STOCKS, TOKENS } from "@stockx/shared";
import { getPriceCached } from "./price-queue";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export interface Tracked { symbol: string; name: string; address: Address; decimals: number }
export const TRACKED: Tracked[] = [
  { symbol: "USDT", name: "Tether", address: TOKENS.USDT.address, decimals: TOKENS.USDT.decimals },
  ...listLiveStockTokens().map((t) => ({ symbol: t.symbol, name: t.name, address: t.address as Address, decimals: t.decimals })),
];

export interface EthTracked extends Tracked { ticker: string }
/** Stock tokens on Ethereum that can be traded here. Their price is approximated by the same company's BNB Chain token. */
export const ETH_TRACKED: EthTracked[] = listEthStockTokens().map((t) => ({
  symbol: t.symbol, name: t.name ?? t.symbol, address: t.address as Address, decimals: t.decimals, ticker: t.symbol.replace(/on$/, ""),
}));
const ETH_USDC = CHAINS.ethereum.cash;

/** Balances (one multicall) and live prices for the connected wallet. Shared by Portfolio and the home panel. */
export function usePortfolio() {
  const { address, isConnected } = useAccount();
  const bnb = useBalance({ address, chainId: 56, query: { enabled: !!address, refetchInterval: 20_000 } });
  const balances = useReadContracts({
    contracts: TRACKED.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ZERO], chainId: 56 }) as const),
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  // Ethereum: ETH, USDC and the tradable Ondo tokens, read from the same wallet.
  const ethNative = useBalance({ address, chainId: 1, query: { enabled: !!address, refetchInterval: 20_000 } });
  const ethBalances = useReadContracts({
    contracts: [{ address: ETH_USDC.address as Address }, ...ETH_TRACKED].map((t) =>
      ({ address: t.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ZERO], chainId: 1 }) as const),
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [ethStockPrice, setEthStockPrice] = useState<Record<string, number>>({});
  const [stockPrice, setStockPrice] = useState<Record<string, number>>({});
  const [bnbPrice, setBnbPrice] = useState<number | null>(null);

  // BNB is a real token too (it's just also what gas is paid in), so it gets a live price like everything else.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/bnb-price");
        const json = (await res.json()) as { price?: number };
        if (alive && json.price) setBnbPrice(json.price);
      } catch { /* keep last known price */ }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const json = (await (await fetch("/api/bnb-price?symbol=ETH")).json()) as { price?: number };
        if (alive && json.price) setEthPrice(json.price);
      } catch { /* keep last known price */ }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const ethUsdc = (() => {
    const r = ethBalances.data?.[0];
    return r && r.status === "success" ? Number(formatUnits(r.result as bigint, ETH_USDC.decimals)) : 0;
  })();
  const ethRows = ETH_TRACKED.map((t, i) => {
    const r = ethBalances.data?.[i + 1];
    const qty = r && r.status === "success" ? Number(formatUnits(r.result as bigint, t.decimals)) : null;
    return { ...t, qty };
  });
  const ethHeld = ethRows.filter((r) => (r.qty ?? 0) > 0);
  const ethHeldKey = ethHeld.map((r) => r.ticker).join(",");
  useEffect(() => {
    if (!ethHeldKey) { setEthStockPrice({}); return; }
    let alive = true;
    const load = async () => {
      const out: Record<string, number> = {};
      await Promise.all(ethHeldKey.split(",").map(async (ticker) => {
        const bsc = STOCKS.find((s) => s.ticker === ticker && s.address);
        if (!bsc?.address) return;
        try { out[ticker] = (await getPriceCached(bsc.address)).onchain; } catch { /* price stays unknown */ }
      }));
      if (alive) setEthStockPrice(out);
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [ethHeldKey]);
  const ethStocks = ethHeld.reduce((sum, r) => sum + (r.qty ?? 0) * (ethStockPrice[r.ticker] ?? 0), 0);
  const ethValue = ethNative.data && ethPrice ? Number(ethNative.data.formatted) * ethPrice : 0;

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
  const bnbValue = bnb.data && bnbPrice ? Number(bnb.data.formatted) * bnbPrice : 0;
  return {
    address, isConnected, bnb, bnbPrice, bnbValue, balances, rows, cash, heldStocks, stockPrice, stocks,
    ethNative, ethPrice, ethValue, ethUsdc, ethHeld, ethStockPrice, ethStocks, ethBalances,
    total: cash + stocks + bnbValue + ethUsdc + ethStocks + ethValue,
  };
}
