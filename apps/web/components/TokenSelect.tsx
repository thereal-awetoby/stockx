"use client";
import { useEffect, useRef, useState } from "react";
import { STOCKS } from "@stockx/shared";
import TokenLogo from "./TokenLogo";

/** Token picker in the same style as the header search: logo, company name, then the ticker. */
export default function TokenSelect({ value, onChange, disabled, label }: { value: string; onChange: (symbol: string) => void; disabled?: boolean; label: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
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
  const list = STOCKS.filter((s) => s.address && (!needle || [s.name, s.ticker, s.token].some((f) => f.toLowerCase().includes(needle))));
  const pick = (symbol: string) => { onChange(symbol); setOpen(false); setQ(""); };

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
            placeholder="Search stocks, tickers or tokens"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && list[0]) pick(list[0].token); }}
          />
          {list.length === 0 ? (
            <div className="muted small" style={{ padding: "12px 14px" }}>No matches.</div>
          ) : (
            <ul className="results">
              {list.map((s) => (
                <li key={s.slug}>
                  <button type="button" className="result" onClick={() => pick(s.token)}>
                    <TokenLogo symbol={s.token} name={s.name} size={24} />
                    <span><strong>{s.name}</strong> <span className="muted small">{s.ticker}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
