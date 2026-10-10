"use client";
import { useEffect, useState } from "react";
import type { Stock } from "@stockx/shared";

interface Info {
  description: string | null; ceo: string | null; industry: string | null; concepts: string[];
  holders: string | null; priceChangePct24h: string | null; marketCap: string | null; circulatingSupply: string | null;
  sharesMultiplier: string | null; high52w: string | null; low52w: string | null; pe: string | null; dividendYield: string | null;
}

const n = (v: string | null) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : null);
const compact = (v: string | null) => { const x = n(v); return x === null ? "—" : x.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 }); };
const money = (v: string | null) => { const x = n(v); return x === null ? "—" : x.toLocaleString("en-US", { style: "currency", currency: "USD" }); };
const plain = (v: string | null, dp = 2) => { const x = n(v); return x === null ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: dp }); };

export default function StockInfo({ stock }: { stock: Stock }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/rwa/info?token=${encodeURIComponent(stock.token)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Unavailable");
        if (alive) setInfo(json as Info);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, [stock.token]);

  const change = n(info?.priceChangePct24h ?? null);
  const text = info?.description ?? "";
  const short = text.length > 320 && !more ? `${text.slice(0, 320).trimEnd()}…` : text;

  return (
    <>
      <section className="card">
        <h2 className="section-title">About</h2>
        {text && <p style={{ margin: "0 0 10px" }}>{short}{text.length > 320 && <> <button type="button" className="link" onClick={() => setMore((v) => !v)}>{more ? "Show less" : "Show more"}</button></>}</p>}
        {!text && !error && <p className="muted small">Loading company details…</p>}
        {error && <p className="muted small">Company details are unavailable right now.</p>}
        <div className="row"><span className="muted">Underlying stock</span><span>{stock.name} ({stock.ticker})</span></div>
        {info?.industry && <div className="row"><span className="muted">Industry</span><span>{info.industry}</span></div>}
        {info?.ceo && <div className="row"><span className="muted">CEO</span><span>{info.ceo}</span></div>}
        <div className="row"><span className="muted">Issuer</span><span>{stock.issuer}</span></div>
        <div className="row"><span className="muted">Chain</span><span>BNB Chain</span></div>
        {stock.address && (
          <div className="row">
            <span className="muted">Token</span>
            <span className="small">
              <button type="button" className="addr" title="Click to copy" onClick={async () => { await navigator.clipboard.writeText(stock.address!); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                {copied ? "Copied" : `${stock.address.slice(0, 8)}…${stock.address.slice(-6)}`}
              </button>{" "}
              <a href={`https://bscscan.com/token/${stock.address}`} target="_blank" rel="noreferrer" aria-label="View on explorer">↗</a>
            </span>
          </div>
        )}
        {!!info?.concepts.length && <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>{info.concepts.slice(0, 6).map((c) => <span key={c} className="badge">{c}</span>)}</div>}
      </section>

      <section className="card">
        <h2 className="section-title">Statistics</h2>
        <div className="stat-grid">
          <div className="row"><span className="muted">24h change</span><span className={change === null ? "" : change >= 0 ? "pos" : "neg"}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</span></div>
          <div className="row"><span className="muted">Holders</span><span>{plain(info?.holders ?? null, 0)}</span></div>
          <div className="row"><span className="muted">On-chain market cap</span><span>{compact(info?.marketCap ?? null)}</span></div>
          <div className="row"><span className="muted">Circulating supply</span><span>{compact(info?.circulatingSupply ?? null)}</span></div>
          <div className="row"><span className="muted">52-week high</span><span>{money(info?.high52w ?? null)}</span></div>
          <div className="row"><span className="muted">52-week low</span><span>{money(info?.low52w ?? null)}</span></div>
          <div className="row"><span className="muted">P/E ratio</span><span>{plain(info?.pe ?? null)}</span></div>
          <div className="row"><span className="muted">Dividend yield</span><span>{info?.dividendYield ? `${plain(info.dividendYield)}%` : "—"}</span></div>
          <div className="row"><span className="muted">Shares per token</span><span>{plain(info?.sharesMultiplier ?? null, 4)}</span></div>
        </div>
        <p className="muted small" style={{ margin: "8px 0 0" }}>One token is about {plain(info?.sharesMultiplier ?? null, 4)} shares, not exactly one. Source: Binance Web3.</p>
      </section>
    </>
  );
}
