"use client";
import Link from "next/link";
import BuyPanel from "./BuyPanel";
import { useEffect, useState } from "react";
import {
  calcPremiumPct,
  createApiPriceProvider,
  createMockPriceProvider,
  getRwaMarket,
  getUsMarketStatus,
  RFQ_TTL_MS,
  type MarketStatus,
  type PriceSnapshot,
  type RwaMarketState,
  type Stock,
} from "@stockx/shared";

// NEXT_PUBLIC_PRICE_PROVIDER=mock forces fake prices for UI work. Default is the real API.
const prices = process.env.NEXT_PUBLIC_PRICE_PROVIDER === "mock" ? createMockPriceProvider() : createApiPriceProvider();
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

/** The API may send epoch seconds, epoch ms, or an ISO string. Handle all three. */
function toDate(v: string | number | null): Date | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
const fmtTime = (d: Date) =>
  d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

export default function StockView({ stock }: { stock: Stock }) {
  const [snap, setSnap] = useState<PriceSnapshot | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [apiMarket, setApiMarket] = useState<RwaMarketState | null>(null);
  const [localMarket, setLocalMarket] = useState<MarketStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const loadPrices = async () => {
      try {
        const s = await prices.getPrices(stock.address ?? stock.token);
        if (alive) { setSnap(s); setPriceError(null); }
      } catch (e) {
        if (alive) setPriceError((e as Error).message);
      }
    };
    const loadMarket = async () => {
      setLocalMarket(getUsMarketStatus()); // fallback estimate, always available
      if (!stock.address) return;
      try {
        const m = await getRwaMarket(stock.address);
        if (alive) setApiMarket(m);
      } catch {
        if (alive) setApiMarket(null);
      }
    };
    loadPrices();
    loadMarket();
    const a = setInterval(loadPrices, 15_000);
    const b = setInterval(loadMarket, 30_000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, [stock.token, stock.address]);

  const premium = snap ? calcPremiumPct(snap.onchain, snap.reference) : null;
  const open = apiMarket ? apiMarket.open : localMarket?.open;
  const nextOpen = apiMarket ? toDate(apiMarket.nextOpenTime) : localMarket && !localMarket.open ? localMarket.nextOpen : null;
  const closes = apiMarket ? toDate(apiMarket.nextCloseTime) : localMarket?.open ? localMarket.closesAt ?? null : null;

  return (
    <main>
      <Link href="/markets" className="muted small">← Markets</Link>
      <h1 style={{ marginTop: 8 }}>{stock.ticker} <span className="muted" style={{ fontWeight: 400 }}>{stock.name}</span></h1>
      <p className="sub">{stock.token} · {stock.issuer}</p>

      {/* The closed-market line is the stock product. */}
      <div className="card">
        <div className="row">
          <span>US market</span>
          {open === undefined ? <span className="muted">…</span> : (
            <span className={`pill ${open ? "open" : "closed"}`}>{apiMarket ? (open ? "Trading" : "Closed") : (open ? "Open" : "Closed")}</span>
          )}
        </div>
        {apiMarket?.reasonCode && (
          <div className="row muted"><span>Status</span><span>{apiMarket.reasonCode}</span></div>
        )}
        {open === false && nextOpen && (
          <div className="row muted"><span>Next open</span><span>{fmtTime(nextOpen)}</span></div>
        )}
        {open === true && closes && (
          <div className="row muted"><span>Closes</span><span>{fmtTime(closes)}</span></div>
        )}
        {!apiMarket && localMarket && (
          <p className="muted small" style={{ margin: "8px 0 0" }}>Estimated from regular US hours (live status unavailable).</p>
        )}
        {open === false && (
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
        {snap && snap.source !== "mock" && (
          <p className="muted small" style={{ margin: "8px 0 0" }}>
            Source: Binance Web3 RWA data · updated {new Date(snap.asOf).toLocaleTimeString()}
          </p>
        )}
        {priceError && <p className="err">Live prices unavailable: {priceError}</p>}
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

      <BuyPanel stock={stock} />
    </main>
  );
}