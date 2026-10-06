"use client";
import Link from "next/link";
import { useState } from "react";
import { searchStocks } from "@stockx/shared";

export default function MarketsList() {
  const [q, setQ] = useState("");
  const results = searchStocks(q);

  return (
    <>
      <input
        className="search"
        placeholder="Search ticker, company or token (e.g. AAPL, AAPLB)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.length === 0 && <div className="card muted">No stocks match “{q}”.</div>}
      {results.map((s) =>
        s.status === "live" ? (
          <Link key={s.slug} href={`/stock/${s.slug}`} className="card stock-row">
            <div>
              <strong>{s.ticker}</strong> <span className="muted">{s.name}</span>
              <div className="muted small">{s.token} · {s.issuer}</div>
            </div>
            <span className="badge">{s.style === "rfq" ? "RFQ" : "Normal swap"}</span>
          </Link>
        ) : (
          <div key={s.slug} className="card stock-row disabled">
            <div>
              <strong>{s.ticker}</strong> <span className="muted">{s.name}</span>
              <div className="muted small">{s.token} · {s.issuer}</div>
            </div>
            <span className="badge soon">Coming soon</span>
          </div>
        ),
      )}
    </>
  );
}