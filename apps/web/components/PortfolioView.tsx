"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { listStockTokens, TOKENS } from "@stockx/shared";
import { readPocket } from "@stockx/shared/pocket";
import Donut from "./Donut";
import TokenLogo from "./TokenLogo";
import { usd } from "../lib/format";
import { importTradeFromHash } from "../lib/trade-import";
import { readTradesFor, recordTrade, subscribeTrades, type TradeEntry } from "../lib/trade-log";
import { usePortfolio } from "../lib/usePortfolio";

const fmt = (n: number, dp = 6) => n.toLocaleString("en-US", { maximumFractionDigits: dp });
const ALL_TOKENS = [
  { symbol: "USDT", address: TOKENS.USDT.address as string, decimals: TOKENS.USDT.decimals },
  ...listStockTokens().map((t) => ({ symbol: t.symbol, address: t.address as string, decimals: t.decimals })),
];

export default function PortfolioView() {
  const { address, isConnected, bnb, balances, cash, heldStocks, stockPrice, stocks, total } = usePortfolio();
  const publicClient = usePublicClient({ chainId: 56 });
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [pocketAddr, setPocketAddr] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    try { setPocketAddr(readPocket(localStorage)?.address ?? null); } catch { setPocketAddr(null); }
  }, []);

  // Recent transactions: this wallet's trades plus the agent pocket's, live-updated when a trade is recorded.
  useEffect(() => {
    if (!address) return;
    const load = () => setTrades(readTradesFor(pocketAddr ? [address, pocketAddr] : [address]));
    load();
    return subscribeTrades(load);
  }, [address, pocketAddr]);

  // One-time sync per address from the explorer API (when the server has a key): fills in older trades.
  const [syncNote, setSyncNote] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const owners = pocketAddr ? [address, pocketAddr] : [address];
    for (const owner of owners) {
      fetch(`/api/history?address=${owner}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { configured?: boolean; trades?: TradeEntry[]; error?: string } | null) => {
          if (!alive || !j) return;
          if (j.configured === false) { setSyncNote("not-configured"); return; }
          if (j.error) { setSyncNote(j.error); return; }
          const viaAgent = pocketAddr !== null && owner.toLowerCase() === pocketAddr.toLowerCase();
          for (const t of j.trades ?? []) recordTrade(owner, viaAgent ? { ...t, via: "agent" } : t);
        })
        .catch(() => undefined);
    }
    return () => { alive = false; };
  }, [address, pocketAddr]);

  async function importTx() {
    const h = hash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) { setImportMsg("Paste the full transaction hash (0x followed by 64 characters)."); return; }
    if (!publicClient || !address) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const owners = pocketAddr ? [address, pocketAddr] : [address];
      const found = await importTradeFromHash(publicClient, h as Hex, owners, ALL_TOKENS);
      if (found === "failed") setImportMsg("That transaction failed on-chain, so there is no trade to add.");
      else if (!found) setImportMsg("That doesn't look like a stock buy or sell for your wallet or agent pocket.");
      else {
        const viaAgent = pocketAddr !== null && found.owner.toLowerCase() === pocketAddr.toLowerCase();
        recordTrade(found.owner, viaAgent ? { ...found.entry, via: "agent" } : found.entry);
        setHash("");
        setImportMsg("Added.");
      }
    } catch {
      setImportMsg("Couldn't read that transaction. Check the hash and try again.");
    } finally {
      setImporting(false);
    }
  }

  if (!isConnected || !address) {
    return <div className="card muted">Connect your wallet to see your portfolio.</div>;
  }

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
                    <td><div className="name"><TokenLogo symbol={r.symbol} name={r.name} /><div><strong>{r.symbol}</strong><div className="muted small">{r.name}</div></div></div></td>
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
          <div className="card muted small">No trades yet. Buys and sells from your wallet and the agent show up here as they happen.</div>
        ) : (
          <section className="sheet sheet-scroll">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th className="num">Paid</th><th className="num">Received</th><th /></tr></thead>
              <tbody>
                {trades.map((x) => (
                  <tr key={x.txHash}>
                    <td>{new Date(x.t).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td>
                      <span className="badge">{x.side === "buy" ? "Buy" : "Sell"} {x.token}</span>
                      {x.via === "agent" && <span className="badge" style={{ marginLeft: 6 }}>Agent</span>}
                    </td>
                    <td className="num">{fmt(Number(x.amountIn))} {x.inSym}</td>
                    <td className="num">{x.amountOut ? `${fmt(Number(x.amountOut))} ${x.outSym}` : "—"}</td>
                    <td className="num"><a href={`https://bscscan.com/tx/${x.txHash}`} target="_blank" rel="noreferrer">View</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <div className="import-row">
          <input
            value={hash}
            placeholder="Add an older trade: paste its transaction hash"
            onChange={(e) => { setHash(e.target.value); setImportMsg(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void importTx(); }}
            spellCheck={false}
          />
          <button type="button" className="ghost" disabled={importing || !hash.trim()} onClick={() => void importTx()}>{importing ? "Reading…" : "Add"}</button>
        </div>
        {importMsg && <p className={`small ${importMsg === "Added." ? "pos" : "err"}`} style={{ margin: "6px 0 0" }}>{importMsg}</p>}
        {syncNote && (
          <p className="muted small" style={{ marginTop: 10 }}>
            {syncNote === "not-configured" ? "Automatic BscScan sync is off (no explorer API key on the server)." : `Automatic BscScan sync unavailable: ${syncNote}`}
          </p>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>Trades made through stockX in this browser appear automatically. For trades made elsewhere, paste the hash above and it is read from the chain.</p>
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
