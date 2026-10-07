"use client";
import { useEffect, useState } from "react";
import {
  getRwaMarket,
  getUsMarketStatus,
  STOCKS,
  type MarketStatus,
  type RwaMarketState,
} from "@stockx/shared";

/** The API may send epoch seconds, epoch ms, or an ISO string. Handle all three. */
function toDate(v: string | number | null): Date | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
const fmt = (d: Date) =>
  d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

/** "The closed-market line is the stock product." Uses the live API status, falls back to a local estimate. */
export default function MarketBanner() {
  const [local, setLocal] = useState<MarketStatus | null>(null);
  const [api, setApi] = useState<RwaMarketState | null>(null);

  useEffect(() => {
    let alive = true;
    const address = STOCKS.find((s) => s.status === "live")?.address;
    const tick = async () => {
      setLocal(getUsMarketStatus());
      if (!address) return;
      try {
        const m = await getRwaMarket(address);
        if (alive) setApi(m);
      } catch {
        if (alive) setApi(null);
      }
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!local) return <div className="card muted">Checking US market…</div>;

  const open = api ? api.open : local.open;
  const label = api ? (open ? "Trading" : "Closed") : local.label;
  const nextOpen = api ? toDate(api.nextOpenTime) : local.open ? null : local.nextOpen;
  const closes = api ? toDate(api.nextCloseTime) : local.open ? local.closesAt ?? null : null;

  return (
    <div className="card">
      <div className="row">
        <span>US market</span>
        <span className={`pill ${open ? "open" : "closed"}`}>{label}</span>
      </div>
      {api?.reasonCode && (
        <div className="row muted"><span>Status</span><span>{api.reasonCode}</span></div>
      )}
      {!open && nextOpen && (
        <div className="row muted"><span>Next open</span><span>{fmt(nextOpen)}</span></div>
      )}
      {open && closes && (
        <div className="row muted"><span>Closes</span><span>{fmt(closes)}</span></div>
      )}
      {!api && (
        <p className="muted small" style={{ margin: "8px 0 0" }}>Estimated from regular US hours (live status unavailable).</p>
      )}
      {!open && (
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          Reference price is stale while the market is closed, so the premium can look large.
        </p>
      )}
    </div>
  );
}