"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Sparkline from "./Sparkline";
import { usd } from "../lib/format";
import { usePortfolio } from "../lib/usePortfolio";

/** Home panel: wallet value, 24h change, a 24h chart and a link to the portfolio. */
export default function PortfolioStrip() {
  const { isConnected, cash, heldStocks, total, balances } = usePortfolio();
  const [series, setSeries] = useState<Record<string, number[]>>({});
  const symbolsKey = heldStocks.map((r) => r.symbol).join(",");

  useEffect(() => {
    if (!symbolsKey) { setSeries({}); return; }
    let alive = true;
    fetch(`/api/rwa/overview?tokens=${symbolsKey}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: Record<string, { spark?: number[] }>) => {
        if (!alive) return;
        const out: Record<string, number[]> = {};
        for (const s of symbolsKey.split(",")) if (j[s]?.spark?.length) out[s] = j[s].spark!;
        setSeries(out);
      })
      .catch(() => { if (alive) setSeries({}); });
    return () => { alive = false; };
  }, [symbolsKey]);

  // Value over the last 24h of what is held NOW: USDT stays flat, each stock follows its own 24h price line.
  const { values, changePct } = useMemo(() => {
    const lines = heldStocks.map((r) => ({ qty: r.qty ?? 0, pts: series[r.symbol] })).filter((l): l is { qty: number; pts: number[] } => !!l.pts);
    const n = lines.length ? Math.min(...lines.map((l) => l.pts.length)) : 24;
    const v = Array.from({ length: n }, (_, i) => cash + lines.reduce((sum, l) => sum + l.qty * l.pts[l.pts.length - n + i]!, 0));
    const first = v[0] ?? 0;
    const last = v[v.length - 1] ?? 0;
    return { values: v, changePct: first > 0 ? ((last - first) / first) * 100 : 0 };
  }, [series, heldStocks, cash]);

  if (!isConnected) {
    return <div className="card strip muted">Connect your wallet to see your portfolio value here.</div>;
  }
  const up = changePct >= 0;
  return (
    <div className="card strip">
      <div>
        <div className="muted small">Total portfolio value</div>
        <div className="big-price">{balances.isLoading ? "…" : usd(total)}</div>
        <div className="small" style={{ marginTop: 6 }}>
          <span className="muted">24H </span>
          <span className={up ? "pos" : "neg"}>{up ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%</span>
        </div>
      </div>
      <div className="strip-chart" title="Last 24 hours, valued at the tokens you hold now">
        <Sparkline values={values} up={up} width={420} height={64} />
      </div>
      <Link href="/portfolio" className="strip-link">View portfolio <span aria-hidden>›</span></Link>
    </div>
  );
}
