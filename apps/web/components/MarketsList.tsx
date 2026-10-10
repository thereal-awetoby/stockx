"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  calcPremiumPct,
  createApiPriceProvider,
  createMockPriceProvider,
  searchStocks,
  type PriceSnapshot,
  type Stock,
} from "@stockx/shared";

const prices = process.env.NEXT_PUBLIC_PRICE_PROVIDER === "mock" ? createMockPriceProvider() : createApiPriceProvider();
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

function LiveRow({ s }: { s: Stock }) {
  const router = useRouter();
  const [snap, setSnap] = useState<PriceSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const x = await prices.getPrices(s.address ?? s.token);
        if (alive) { setSnap(x); setFailed(false); }
      } catch {
        if (alive) setFailed(true);
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [s.address, s.token]);

  const premium = snap ? calcPremiumPct(snap.onchain, snap.reference) : null;
  const cell = (v: string | null) => (v ?? (failed ? "—" : "…"));

  return (
    <tr className="click" onClick={() => router.push(`/stock/${s.slug}`)}>
      <td>
        <div className="name">
          <span className="avatar">{s.name.slice(0, 1)}</span>
          <div>
            <Link href={`/stock/${s.slug}`}><strong>{s.name}</strong></Link>
            <div className="muted small">{s.token} · {s.issuer}</div>
          </div>
        </div>
      </td>
      <td className="num">{cell(snap && usd(snap.onchain))}</td>
      <td className="num">{cell(snap && usd(snap.reference))}</td>
      <td className={`num ${premium !== null && premium < 0 ? "neg" : "pos"}`}>
        {premium === null ? cell(null) : `${premium >= 0 ? "+" : ""}${premium.toFixed(2)}%`}
      </td>
      <td><span className="badge">{s.style === "rfq" ? "RFQ" : "Normal swap"}</span></td>
    </tr>
  );
}

export default function MarketsList() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"live" | "all">("live");
  const matches = searchStocks(q);
  // Searching looks through everything. Otherwise the default tab shows only what can be traded.
  const results = q.trim() || tab === "all" ? matches : matches.filter((s) => s.status === "live");

  return (
    <>
      <input
        className="search"
        placeholder="Search ticker, company or token (e.g. AAPL, AAPLB)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button type="button" className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>Tradable</button>
        <button type="button" className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All {searchStocks("").length}</button>
      </div>
      {results.length === 0 ? (
        <div className="card muted">No stocks match “{q}”.</div>
      ) : (
        <section className="sheet sheet-scroll">
          <table>
            <thead>
              <tr><th>Asset</th><th className="num">Token price</th><th className="num">Stock price</th><th className="num">Premium</th><th>Quote</th></tr>
            </thead>
            <tbody>
              {results.map((s) =>
                s.status === "live" ? (
                  <LiveRow key={s.slug} s={s} />
                ) : (
                  <tr key={s.slug} className="disabled">
                    <td>
                      <div className="name">
                        <span className="avatar">{s.name.slice(0, 1)}</span>
                        <div><strong>{s.name}</strong><div className="muted small">{s.token} · {s.issuer}</div></div>
                      </div>
                    </td>
                    <td colSpan={3} className="muted">{s.note ?? ""}</td>
                    <td><span className="badge soon">Coming soon</span></td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
