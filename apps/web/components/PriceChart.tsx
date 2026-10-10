"use client";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { ChartSeries, KlineRange } from "@stockx/shared";
import { usd } from "../lib/format";

const RANGES: KlineRange[] = ["1D", "1W", "1M", "3M", "ALL"];
const H = 240;
const PAD = { t: 12, r: 64, b: 26, l: 0 };
const fmtTime = (t: number, range: KlineRange) =>
  range === "1D" || range === "1W"
    ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function PriceChart({ token }: { token: string }) {
  const gid = useId().replace(/:/g, "");
  const [range, setRange] = useState<KlineRange>("1D");
  const [series, setSeries] = useState<ChartSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [w, setW] = useState(640);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    setSeries(null);
    setError(null);
    setHover(null);
    const load = async () => {
      try {
        const res = await fetch(`/api/rwa/kline?token=${encodeURIComponent(token)}&range=${range}`);
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(json?.error ?? "Chart unavailable");
        setSeries(json as ChartSeries);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [token, range]);

  const up = (series?.changePct ?? 0) >= 0;
  const color = up ? "var(--up)" : "var(--down)";
  const pts = series?.points ?? [];
  const closes = pts.map((p) => p.c);
  const lo = closes.length ? Math.min(...closes) : 0;
  const hi = closes.length ? Math.max(...closes) : 1;
  const pad = (hi - lo) * 0.08 || hi * 0.001 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const plotW = w - PAD.l - PAD.r;
  const x = (i: number) => PAD.l + (pts.length > 1 ? (i / (pts.length - 1)) * plotW : 0);
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${x(pts.length - 1).toFixed(1)},${H - PAD.b} L${x(0).toFixed(1)},${H - PAD.b} Z` : "";
  const shown = hover !== null && pts[hover] ? pts[hover] : pts[pts.length - 1];
  const ticks = [max - pad, (max + min) / 2, min + pad];

  function onMove(e: PointerEvent<SVGSVGElement>) {
    if (pts.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    setHover(Math.min(pts.length - 1, Math.max(0, Math.round(((px - PAD.l) / plotW) * (pts.length - 1)))));
  }

  return (
    <div>
      <div className="chart-head">
        <div>
          <div className="big-price">{shown ? usd(shown.c) : "…"}</div>
          {series && (
            <div className="small" style={{ marginTop: 4 }}>
              {hover === null ? (
                <span className={up ? "pos" : "neg"}>{up ? "▲" : "▼"} {Math.abs(series.changePct).toFixed(2)}% <span className="muted">{range === "ALL" ? "all time" : range}</span></span>
              ) : (
                <span className="muted">{shown ? fmtTime(shown.t, range) : ""}</span>
              )}
            </div>
          )}
        </div>
        <div className="tabs" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={r === range} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>

      <div ref={box} className="chart-wrap">
        {error ? (
          <div className="chart-empty">{error}</div>
        ) : !series ? (
          <div className="chart-empty">Loading chart…</div>
        ) : (
          <svg width={w} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }} role="img" aria-label={`${token} price chart`}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="2 4" />
                <text x={w - PAD.r + 8} y={y(v) + 4} fontSize="11" fill="var(--muted)">{usd(v)}</text>
              </g>
            ))}
            <path d={area} fill={`url(#${gid})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" />
            <text x={PAD.l} y={H - 6} fontSize="11" fill="var(--muted)">{fmtTime(pts[0].t, range)}</text>
            <text x={w - PAD.r} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">{fmtTime(pts[pts.length - 1].t, range)}</text>
            {hover !== null && pts[hover] && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-strong)" />
                <circle cx={x(hover)} cy={y(pts[hover].c)} r="4" fill={color} stroke="var(--sheet)" strokeWidth="2" />
              </g>
            )}
          </svg>
        )}
      </div>
      <p className="muted small" style={{ margin: "6px 0 0" }}>On-chain token price from Binance Web3. ALL shows up to the last 300 days.</p>
    </div>
  );
}
