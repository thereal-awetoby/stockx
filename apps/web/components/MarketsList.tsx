"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { calcPremiumPct, categoryOf, searchStocks, STOCK_CATEGORIES, type PriceSnapshot, type Stock, type StockCategory } from "@stockx/shared";
import { signedPct, usd } from "../lib/format";
import { useOverview } from "../lib/overview";
import { getPriceCached } from "../lib/price-queue";
import Sparkline from "./Sparkline";
import TokenLogo from "./TokenLogo";

const PAGE = 20;
// Tradable tokens first, then the rest.
const ALL: Stock[] = searchStocks("").slice().sort((a, b) => Number(b.status === "live") - Number(a.status === "live"));
const PRESENT = STOCK_CATEGORIES.filter((c) => ALL.some((s) => categoryOf(s.ticker) === c));

function Row({ s }: { s: Stock }) {
  const router = useRouter();
  const live = s.status === "live";
  const overview = useOverview(s.token);
  const [snap, setSnap] = useState<PriceSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const row = useRef<HTMLTableRowElement>(null);

  // Only rows on (or near) the screen load a price.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!live || !visible) return;
    let alive = true;
    const load = async () => {
      try {
        const x = await getPriceCached(s.address ?? s.token);
        if (alive) { setSnap(x); setFailed(false); }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [live, visible, s.address, s.token]);

  const premium = snap ? calcPremiumPct(snap.onchain, snap.reference) : null;
  const change = overview?.changePct ?? null;
  const up = (change ?? 0) >= 0;
  const cell = (v: string | null) => v ?? (failed ? "—" : "…");

  return (
    <tr ref={row} className={live ? "click" : "disabled"} onClick={live ? () => router.push(`/stock/${s.slug}`) : undefined}>
      <td>
        <div className="name">
          <TokenLogo symbol={s.token} name={s.name} />
          <div>
            {live ? <Link href={`/stock/${s.slug}`}><strong>{s.name}</strong></Link> : <strong>{s.name}</strong>}
            <div className="muted small">{s.token} · {s.issuer}</div>
          </div>
        </div>
      </td>
      {live ? (
        <>
          <td className="num">{cell(snap && usd(snap.onchain))}</td>
          <td className="num">{cell(snap && usd(snap.reference))}</td>
          <td className={`num ${premium !== null && premium < 0 ? "neg" : "pos"}`}>{premium === null ? cell(null) : signedPct(premium)}</td>
          <td className={`num ${change === null ? "" : up ? "pos" : "neg"}`}>{change === null ? "—" : signedPct(change)}</td>
          <td className="chart-cell"><Sparkline values={overview?.spark ?? []} up={up} /></td>
        </>
      ) : (
        <>
          <td colSpan={4} className="muted">{s.note ?? ""}</td>
          <td className="chart-cell"><span className="badge">Coming soon</span></td>
        </>
      )}
    </tr>
  );
}

export default function MarketsList() {
  const [cat, setCat] = useState<StockCategory | "all">("all");
  const [page, setPage] = useState(1);
  const results = cat === "all" ? ALL : ALL.filter((s) => categoryOf(s.ticker) === cat);
  const pages = Math.max(1, Math.ceil(results.length / PAGE));
  const current = Math.min(page, pages);
  const shown = results.slice((current - 1) * PAGE, current * PAGE);
  const pick = (c: StockCategory | "all") => { setCat(c); setPage(1); };
  const go = (n: number) => { setPage(n); window.scrollTo({ top: 0, behavior: "smooth" }); };
  // numbers come in groups of three: 1 2 3 ›  then  ‹ 4 5 6 ›
  const start = Math.floor((current - 1) / 3) * 3 + 1;
  const numbers = Array.from({ length: Math.min(3, pages - start + 1) }, (_, i) => start + i);

  return (
    <>
      <div className="filters" role="tablist" aria-label="Filter by sector">
        <button type="button" role="tab" aria-selected={cat === "all"} className={cat === "all" ? "on" : ""} onClick={() => pick("all")}>All assets</button>
        {PRESENT.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? "on" : ""} onClick={() => pick(c)}>{c}</button>
        ))}
      </div>

      {results.length === 0 ? (
        <div className="card muted">No assets in this category yet.</div>
      ) : (
        <section className="sheet sheet-scroll">
          <table>
            <thead>
              <tr>
                <th>Asset</th><th className="num">Token price</th><th className="num">Stock price</th>
                <th className="num">Premium</th><th className="num">24h</th><th className="num">24h chart</th>
              </tr>
            </thead>
            <tbody>{shown.map((s) => <Row key={s.slug} s={s} />)}</tbody>
          </table>
        </section>
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {start > 1 && <button type="button" aria-label="Previous pages" onClick={() => go(start - 1)}>‹</button>}
          {numbers.map((n) => (
            <button key={n} type="button" className={n === current ? "on" : ""} aria-current={n === current ? "page" : undefined} onClick={() => go(n)}>{n}</button>
          ))}
          {start + 3 <= pages && <button type="button" aria-label="Next pages" onClick={() => go(start + 3)}>›</button>}
        </nav>
      )}
    </>
  );
}
