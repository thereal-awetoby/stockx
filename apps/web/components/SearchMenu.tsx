"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchStocks } from "@stockx/shared";
import TokenLogo from "./TokenLogo";

export default function SearchMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const results = q.trim() ? searchStocks(q).slice(0, 8) : [];
  const go = (slug: string) => { setOpen(false); setQ(""); router.push(`/stock/${slug}`); };

  return (
    <div className="dd" ref={box}>
      <button type="button" className="icon-btn" aria-label="Search" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" />
        </svg>
      </button>
      {open && (
        <div className="search-pop">
          <input
            ref={input}
            className="search-input"
            placeholder="Search stocks, tickers or tokens"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { const first = results.find((r) => r.status === "live"); if (first) go(first.slug); } }}
          />
          {q.trim() && (results.length === 0 ? (
            <div className="muted small" style={{ padding: "12px 14px" }}>No matches.</div>
          ) : (
            <ul className="results">
              {results.map((s) => (
                <li key={s.slug}>
                  <button type="button" className="result" disabled={s.status !== "live"} onClick={() => go(s.slug)}>
                    <TokenLogo symbol={s.token} name={s.name} size={24} />
                    <span><strong>{s.name}</strong> <span className="muted small">{s.token}</span></span>
                    {s.status !== "live" && <span className="badge" style={{ marginLeft: "auto" }}>Coming soon</span>}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </div>
  );
}
