"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { fetchQuoteView, RFQ_TTL_MS, type QuoteView, type Stock } from "@stockx/shared";

const fmt = (s: string, dp = 6) => Number(s).toLocaleString(undefined, { maximumFractionDigits: dp });

export default function BuyPanel({ stock }: { stock: Stock }) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("5");
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 1s ticker only while a quote is on screen (drives the countdown).
  useEffect(() => {
    if (!quote) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [quote]);

  async function getQuote() {
    setLoading(true);
    setError(null);
    try {
      const q = await fetchQuoteView(amount.trim(), isConnected ? address : undefined);
      setQuote(q);
      setNow(Date.now());
    } catch (e) {
      setQuote(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const secondsLeft = quote ? Math.max(0, Math.ceil((quote.quotedAt + RFQ_TTL_MS - now) / 1000)) : 0;
  const expired = !!quote && secondsLeft === 0;
  const effective = quote && Number(quote.amountOut) > 0 ? Number(quote.amountIn) / Number(quote.amountOut) : null;

  return (
    <div className="card">
      <div className="row"><strong>Buy {stock.token}</strong><span className="muted small">Pay with USDT</span></div>

      <div className="row" style={{ gap: 8 }}>
        <input
          className="search"
          style={{ margin: 0 }}
          inputMode="decimal"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
          placeholder="USDT amount"
        />
        <button onClick={getQuote} disabled={loading}>{loading ? "Quoting…" : quote ? "Refresh" : "Get quote"}</button>
      </div>
      {error && <p className="err">{error}</p>}

      {quote && (
        <>
          <div className="row"><span className="muted">You pay</span><strong>{fmt(quote.amountIn, 4)} USDT</strong></div>
          <div className="row"><span className="muted">You receive</span><strong>{fmt(quote.amountOut)} {stock.token}</strong></div>
          {effective !== null && (
            <div className="row"><span className="muted">Effective price</span><span>{effective.toLocaleString(undefined, { style: "currency", currency: "USD" })}</span></div>
          )}
          <div className="row"><span className="muted">Price impact</span><span>{Number(quote.priceImpactPercent).toFixed(4)}%</span></div>
          <div className="row"><span className="muted">Route</span><span className="small">{quote.route.join(" → ")}</span></div>
          <div className="row"><span className="muted">Mode · est. gas</span><span className="small">{quote.executionMode} · {Number(quote.gasEstimate).toLocaleString()} units</span></div>
          <div className="row">
            <span className="muted">Quote</span>
            <span className={expired ? "neg" : "muted"}>{expired ? "Expired. Refresh" : `fresh for ${secondsLeft}s`}</span>
          </div>
        </>
      )}

      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button disabled style={{ flex: 1 }}>{isConnected ? `Buy ${stock.token}` : "Connect wallet to buy"}</button>
        <button disabled className="ghost" style={{ flex: 1 }}>Sell {stock.token}</button>
      </div>
      <p className="muted small" style={{ margin: "8px 0 0" }}>Quotes are live. Signing and sending arrive in the next step.</p>
    </div>
  );
}