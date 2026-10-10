"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { createApiPriceProvider, createMockPriceProvider, listLiveStockTokens, TOKENS } from "@stockx/shared";
import Donut from "./Donut";
import { readTrades, type TradeEntry } from "../lib/trade-log";

const prices = process.env.NEXT_PUBLIC_PRICE_PROVIDER === "mock" ? createMockPriceProvider() : createApiPriceProvider();
const LIVE_TOKENS = listLiveStockTokens();
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmt = (n: number, dp = 6) => n.toLocaleString(undefined, { maximumFractionDigits: dp });

interface HoldingProps {
  symbol: string;
  label: string;
  address: Address;
  decimals: number;
  owner: Address;
  price: number | null;
  onValue: (symbol: string, value: number | null) => void;
}

function Holding({ symbol, label, address, decimals, owner, price, onValue }: HoldingProps) {
  const { data, error, isLoading } = useReadContract({
    address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
    chainId: 56,
    query: { refetchInterval: 20_000 },
  });
  const qty = data === undefined ? null : Number(formatUnits(data, decimals));
  const value = qty !== null && price !== null ? qty * price : null;
  useEffect(() => { onValue(symbol, value); }, [symbol, value, onValue]);

  return (
    <tr>
      <td><div className="name"><span className="avatar">{symbol.slice(0, 1)}</span><div><strong>{symbol}</strong><div className="muted small">{label}</div></div></div></td>
      <td className="num">{price === null ? "—" : usd(price)}</td>
      <td className="num">{error ? <span className="neg">unavailable</span> : qty === null ? (isLoading ? "…" : "—") : fmt(qty)}</td>
      <td className="num">{value === null ? "—" : usd(value)}</td>
    </tr>
  );
}

export default function PortfolioView() {
  const { address, isConnected } = useAccount();
  const bnb = useBalance({ address, chainId: 56, query: { enabled: !!address, refetchInterval: 20_000 } });
  const [stockPrice, setStockPrice] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [trades, setTrades] = useState<TradeEntry[]>([]);

  const report = useCallback((symbol: string, value: number | null) => {
    setValues((prev) => (prev[symbol] === value ? prev : { ...prev, [symbol]: value }));
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out: Record<string, number> = {};
      await Promise.all(LIVE_TOKENS.map(async (t) => {
        try { out[t.symbol] = (await prices.getPrices(t.address)).onchain; } catch { /* price stays unknown */ }
      }));
      if (alive) setStockPrice(out);
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => { if (address) setTrades(readTrades(address)); }, [address]);

  if (!isConnected || !address) {
    return <div className="card muted">Connect your wallet to see your portfolio.</div>;
  }

  const cash = values.USDT ?? 0;
  const stocks = LIVE_TOKENS.reduce((sum, t) => sum + (values[t.symbol] ?? 0), 0);
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

        <section className="sheet sheet-scroll" style={{ marginBottom: 16 }}>
          <table>
            <thead><tr><th>Asset</th><th className="num">Price</th><th className="num">Balance</th><th className="num">Value</th></tr></thead>
            <tbody>
              <Holding symbol="USDT" label="Tether" address={TOKENS.USDT.address} decimals={TOKENS.USDT.decimals} owner={address} price={1} onValue={report} />
              {LIVE_TOKENS.map((t) => (
                <Holding key={t.symbol} symbol={t.symbol} label={t.name} address={t.address as Address} decimals={t.decimals} owner={address} price={stockPrice[t.symbol] ?? null} onValue={report} />
              ))}
              <tr>
                <td><div className="name"><span className="avatar">B</span><div><strong>BNB</strong><div className="muted small">Gas</div></div></div></td>
                <td className="num">—</td>
                <td className="num">{bnb.error ? <span className="neg">unavailable</span> : bnb.data ? fmt(Number(bnb.data.formatted)) : "…"}</td>
                <td className="num">—</td>
              </tr>
            </tbody>
          </table>
        </section>

        <h2 className="section-title">Recent transactions</h2>
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
