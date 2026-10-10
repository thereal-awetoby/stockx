"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { listLiveStockTokens, TOKENS } from "@stockx/shared";
import Donut from "./Donut";
import { getPriceCached } from "../lib/price-queue";
import { readTrades, type TradeEntry } from "../lib/trade-log";

const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmt = (n: number, dp = 6) => n.toLocaleString(undefined, { maximumFractionDigits: dp });
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

interface Tracked { symbol: string; name: string; address: Address; decimals: number }
const TRACKED: Tracked[] = [
  { symbol: "USDT", name: "Tether", address: TOKENS.USDT.address, decimals: TOKENS.USDT.decimals },
  ...listLiveStockTokens().map((t) => ({ symbol: t.symbol, name: t.name, address: t.address as Address, decimals: t.decimals })),
];

export default function PortfolioView() {
  const { address, isConnected } = useAccount();
  const bnb = useBalance({ address, chainId: 56, query: { enabled: !!address, refetchInterval: 20_000 } });
  // One multicall for every balance, instead of one request per token.
  const balances = useReadContracts({
    contracts: TRACKED.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ZERO], chainId: 56 }) as const),
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const [stockPrice, setStockPrice] = useState<Record<string, number>>({});
  const [trades, setTrades] = useState<TradeEntry[]>([]);

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

  useEffect(() => { if (address) setTrades(readTrades(address)); }, [address]);

  if (!isConnected || !address) {
    return <div className="card muted">Connect your wallet to see your portfolio.</div>;
  }

  const stocks = heldStocks.reduce((sum, r) => sum + (r.qty ?? 0) * (stockPrice[r.address] ?? 0), 0);
  const total = cash + stocks;
  const pct = (v: number) => (total > 0 ? ((v / total) * 100).toFixed(1) : "0.0");

  return (
    <div className="asset">
      <div>
        <div className="card">
          <div className="muted small">Total value</div>
          <div className="big-price">{usd(total)}</div>
          <p className="muted small" style={{ margin: "6px 0 0" }}>USDT plus stock tokens in your connected wallet. BNB is held for gas and is not counted.</p>
        </div>

        <section className="sheet sheet-scroll" style={{ marginBottom: 8 }}>
          <table>
            <thead><tr><th>Asset</th><th className="num">Price</th><th className="num">Balance</th><th className="num">Value</th></tr></thead>
            <tbody>
              <tr>
                <td><div className="name"><span className="avatar">U</span><div><strong>USDT</strong><div className="muted small">Tether</div></div></div></td>
                <td className="num">{usd(1)}</td>
                <td className="num">{balances.isLoading ? "…" : fmt(cash)}</td>
                <td className="num">{usd(cash)}</td>
              </tr>
              {heldStocks.map((r) => {
                const price = stockPrice[r.address];
                return (
                  <tr key={r.symbol}>
                    <td><div className="name"><span className="avatar">{r.symbol.slice(0, 1)}</span><div><strong>{r.symbol}</strong><div className="muted small">{r.name}</div></div></div></td>
                    <td className="num">{price === undefined ? "…" : usd(price)}</td>
                    <td className="num">{fmt(r.qty ?? 0)}</td>
                    <td className="num">{price === undefined ? "…" : usd((r.qty ?? 0) * price)}</td>
                  </tr>
                );
              })}
              <tr>
                <td><div className="name"><span className="avatar">B</span><div><strong>BNB</strong><div className="muted small">Gas</div></div></div></td>
                <td className="num">—</td>
                <td className="num">{bnb.error ? <span className="neg">unavailable</span> : bnb.data ? fmt(Number(bnb.data.formatted)) : "…"}</td>
                <td className="num">—</td>
              </tr>
            </tbody>
          </table>
        </section>
        {balances.error && <p className="err">Could not read token balances right now.</p>}
        {!balances.isLoading && heldStocks.length === 0 && (
          <p className="muted small" style={{ margin: "0 0 16px" }}>No stock tokens yet. Buy one on <Link href="/markets"><u>Explore</u></Link>.</p>
        )}

        <h2 className="section-title" style={{ marginTop: 20 }}>Recent transactions</h2>
        {trades.length === 0 ? (
          <div className="card muted small">No trades from this browser yet. Trades made in stockX appear here.</div>
        ) : (
          <section className="sheet sheet-scroll">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th className="num">Paid</th><th className="num">Received</th><th /></tr></thead>
              <tbody>
                {trades.map((x) => (
                  <tr key={x.txHash}>
                    <td>{new Date(x.t).toLocaleString()}</td>
                    <td><span className="badge">{x.side === "buy" ? "Buy" : "Sell"} {x.token}</span></td>
                    <td className="num">{fmt(Number(x.amountIn))} {x.inSym}</td>
                    <td className="num">{fmt(Number(x.amountOut))} {x.outSym}</td>
                    <td className="num"><a href={`https://bscscan.com/tx/${x.txHash}`} target="_blank" rel="noreferrer">View</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>Only trades made through stockX in this browser are listed. Agent activity is on the <Link href="/pocket"><u>Agent page</u></Link>.</p>
      </div>

      <aside>
        <div className="card">
          <h2 className="section-title">Allocation</h2>
          <div className="alloc">
            <Donut size={150} centre={usd(total)} segments={[{ label: "Cash", value: cash, color: "#c9c0b0" }, { label: "Stocks", value: stocks, color: "#1c1915" }]} />
            <div className="legend">
              <div className="row"><span><span className="dot" style={{ background: "#c9c0b0" }} />Cash (USDT)</span><span>{pct(cash)}%</span></div>
              <div className="row"><span><span className="dot" style={{ background: "#1c1915" }} />Stocks</span><span>{pct(stocks)}%</span></div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
