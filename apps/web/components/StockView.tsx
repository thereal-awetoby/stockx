"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  calcPremiumPct,
  createMockPriceProvider,
  getUsMarketStatus,
  RFQ_TTL_MS,
  type MarketStatus,
  type PriceSnapshot,
  type Stock,
} from "@stockx/shared";

const prices = createMockPriceProvider();
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function StockView({ stock }: { stock: Stock }) {
  const [snap, setSnap] = useState<PriceSnapshot | null>(null);
  const [market, setMarket] = useState<MarketStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const s = await prices.getPrices(stock.token);
      if (alive) setSnap(s);
    };
    load();
    setMarket(getUsMarketStatus());
    const a = setInterval(load, 15_000);
    const b = setInterval(() => setMarket(getUsMarketStatus()), 30_000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, [stock.token]);

  const premium = snap ? calcPremiumPct(snap.onchain, snap.reference) : null;
  const fmtTime = (d: Date) =>
    d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  return (
    <main>
      <Link href="/markets" className="muted small">← Markets</Link>
      <h1 style={{ marginTop: 8 }}>{stock.ticker} <span className="muted" style={{ fontWeight: 400 }}>{stock.name}</span></h1>
      <p className="sub">{stock.token} · {stock.issuer}</p>

      {/* The closed-market line is the stock product. */}
      <div className="card">
        <div className="row">
          <span>US market</span>
          {market ? <span className={`pill ${market.open ? "open" : "closed"}`}>{market.label}</span> : <span className="muted">…</span>}
        </div>
        {market && (
          <div className="row muted">
            <span>{market.open ? "Closes" : "Next open"}</span>
            <span>{fmtTime(market.open ? market.closesAt! : market.nextOpen)}</span>
          </div>
        )}
        {market && !market.open && (
          <p className="muted small" style={{ margin: "8px 0 0" }}>
            The real stock isn’t trading. The reference price is stale, so the premium can look large.
          </p>
        )}
      </div>

      <div className="card">
        <div className="row"><span className="muted">On-chain price ({stock.token})</span><strong>{snap ? usd(snap.onchain) : "…"}</strong></div>
        <div className="row"><span className="muted">Reference price ({stock.ticker})</span><strong>{snap ? usd(snap.reference) : "…"}</strong></div>
        <div className="row">
          <span className="muted">Premium / discount</span>
          <strong className={premium !== null && premium < 0 ? "neg" : "pos"}>
            {premium === null ? "…" : `${premium >= 0 ? "+" : ""}${premium.toFixed(2)}%`}
          </strong>
        </div>
        {snap?.source === "mock" && <p className="warn small">Mock prices for UI development. Not real.</p>}
      </div>

      <div className="card">
        <div className="row">
          <span className="muted">Quote style</span>
          <span className="badge">{stock.style === "rfq" ? `RFQ · quote lasts ${RFQ_TTL_MS / 1000}s` : "Normal swap"}</span>
        </div>
        <div className="row"><span className="muted">Issuer</span><span>{stock.issuer}</span></div>
        {stock.address && (
          <div className="row">
            <span className="muted">Token</span>
            <span className="small">
              <a href={`https://bscscan.com/token/${stock.address}`} target="_blank" rel="noreferrer">
                {stock.address.slice(0, 8)}…{stock.address.slice(-6)}
              </a>{" "}
              <button
                className="ghost tiny"
                onClick={async () => { await navigator.clipboard.writeText(stock.address!); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <button disabled style={{ flex: 1 }}>Buy {stock.token}</button>
          <button disabled className="ghost" style={{ flex: 1 }}>Sell {stock.token}</button>
        </div>
        <p className="muted small" style={{ margin: "8px 0 0" }}>Swapping goes live in A2.</p>
      </div>
    </main>
  );
}