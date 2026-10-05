"use client";
import { useEffect, useState } from "react";
import { getUsMarketStatus, type MarketStatus } from "@stockx/shared";

/** "The closed-market line is the stock product." */
export default function MarketBanner() {
  const [s, setS] = useState<MarketStatus | null>(null);

  useEffect(() => {
    const tick = () => setS(getUsMarketStatus());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!s) return <div className="card muted">Checking US market…</div>;

  const fmt = (d: Date) =>
    d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  return (
    <div className="card">
      <div className="row">
        <span>US market</span>
        <span className={`pill ${s.open ? "open" : "closed"}`}>{s.label}</span>
      </div>
      <div className="row muted">
        <span>{s.open ? "Closes" : "Next open"}</span>
        <span>{fmt(s.open ? s.closesAt! : s.nextOpen)}</span>
      </div>
      {!s.open && (
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
          Reference price is stale while the market is closed, so the premium can look large.
        </p>
      )}
    </div>
  );
}
