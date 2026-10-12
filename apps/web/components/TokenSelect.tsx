"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { STOCKS } from "@stockx/shared";
import { formatBalance } from "../lib/amount";
import { usePortfolio } from "../lib/usePortfolio";
import TokenLogo from "./TokenLogo";

/**
 * Token picker in the style of the header search. What the wallet holds is listed first, with the amount,
 * then every other stock. Search matches company name, ticker, token symbol or contract address.
 */
export default function TokenSelect({ value, onChange, disabled, label, exclude }: { value: string; onChange: (symbol: string) => void; disabled?: boolean; label: string; exclude?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { rows } = usePortfolio();
  const held = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.symbol !== "USDT" && (r.qty ?? 0) > 0) m.set(r.symbol, r.qty ?? 0);
    return m;
  }, [rows]);
  const current = STOCKS.find((s) => s.token === value);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const matches = STOCKS
    .filter((s) => s.address && s.token !== exclude)
    .filter((s) => !needle || [s.name, s.ticker, s.token, s.address ?? ""].some((f) => f.toLowerCase().includes(needle)));
  const mine = matches.filter((s) => held.has(s.token)).sort((a, b) => (held.get(b.token) ?? 0) - (held.get(a.token) ?? 0));
  const others = matches.filter((s) => !held.has(s.token));
  const pick = (symbol: string) => { onChange(symbol); setOpen(false); setQ(""); };

  const row = (s: (typeof STOCKS)[number]) => (
    <li key={s.slug}>
      <button type="button" className="result" onClick={() => pick(s.token)}>
        <TokenLogo symbol={s.token} name={s.name} size={24} />
        <span className="result-name"><strong>{s.name}</strong> <span className="muted small">{s.ticker}</span></span>
        {held.has(s.token) && <span className="result-bal small">{formatBalance(held.get(s.token) ?? 0, 6)}</span>}
      </button>
    </li>
  );

  return (
    <div className="dd tokensel" ref={box}>
      <button type="button" className="tokensel-btn" disabled={disabled} aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <TokenLogo symbol={value} name={current?.name} size={22} />
        <span>{current?.ticker ?? value}</span>
        <span aria-hidden className="muted small">▾</span>
      </button>
      {open && (
        <div className="search-pop tokensel-pop">
          <input
            ref={input}
            className="search-input"
            placeholder="Search name, ticker or contract address"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { const first = mine[0] ?? others[0]; if (first) pick(first.token); } }}
          />
          {matches.length === 0 ? (
            <div className="muted small" style={{ padding: "12px 14px" }}>No matches.</div>
          ) : (
            <div className="results">
              {mine.length > 0 && <div className="result-group">Your holdings</div>}
              {mine.length > 0 && <ul className="result-list">{mine.map(row)}</ul>}
              {mine.length > 0 && others.length > 0 && <div className="result-group">All stocks</div>}
              {others.length > 0 && <ul className="result-list">{others.map(row)}</ul>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
