"use client";
import { useState, type CSSProperties } from "react";
import { getStockToken } from "@stockx/shared";
import { useOverview } from "../lib/overview";

/** What a visitor sees before connecting: one line, one sentence, and drifting stock logos. */
const FEATURED = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "NFLX", "AMD", "COIN", "JPM", "SPY", "QQQ", "ORCL", "PLTR", "HOOD"];

// Where each bubble sits (% of the banner), how big it is, and how it drifts. Strongest on the right, faint on the left.
const SLOTS = [
  { x: 62, y: 16, size: 76, dur: 14, delay: -3, dx: 14, dy: -18, o: 1 },
  { x: 77, y: 50, size: 92, dur: 17, delay: -9, dx: -16, dy: 14, o: 1 },
  { x: 90, y: 12, size: 62, dur: 12, delay: -5, dx: -10, dy: 16, o: 0.95 },
  { x: 69, y: 76, size: 56, dur: 15, delay: -2, dx: 18, dy: -10, o: 0.9 },
  { x: 85, y: 78, size: 68, dur: 13, delay: -7, dx: -14, dy: -16, o: 0.95 },
  { x: 56, y: 46, size: 46, dur: 11, delay: -4, dx: 12, dy: 12, o: 0.8 },
  { x: 93, y: 46, size: 48, dur: 16, delay: -11, dx: -8, dy: -14, o: 0.8 },
  { x: 67, y: 4, size: 40, dur: 10, delay: -6, dx: -12, dy: 10, o: 0.7 },
  { x: 3, y: 68, size: 38, dur: 15, delay: -8, dx: 10, dy: -12, o: 0.4 },
  { x: 38, y: 6, size: 34, dur: 12, delay: -1, dx: 14, dy: 10, o: 0.4 },
  { x: 45, y: 76, size: 42, dur: 14, delay: -10, dx: -12, dy: -10, o: 0.45 },
  { x: 28, y: 80, size: 30, dur: 11, delay: -5, dx: 10, dy: -8, o: 0.35 },
  { x: 50, y: 22, size: 32, dur: 13, delay: -12, dx: -10, dy: 12, o: 0.4 },
  { x: 80, y: 28, size: 36, dur: 16, delay: -3, dx: 10, dy: 12, o: 0.65 },
  { x: 97, y: 78, size: 34, dur: 12, delay: -9, dx: -8, dy: -10, o: 0.5 },
  { x: 14, y: 12, size: 30, dur: 17, delay: -6, dx: 8, dy: 10, o: 0.3 },
];

function Bubble({ symbol, slot }: { symbol: string; slot: (typeof SLOTS)[number] }) {
  const overview = useOverview(symbol);
  const [broken, setBroken] = useState(false);
  if (!overview?.icon || broken) return null; // no placeholder letters on the dark banner
  return (
    <span
      className="bubble"
      aria-hidden
      style={{
        left: `${slot.x}%`, top: `${slot.y}%`, width: slot.size, height: slot.size,
        animationDuration: `${slot.dur}s`, animationDelay: `${slot.delay}s`,
        "--dx": `${slot.dx}px`, "--dy": `${slot.dy}px`, "--o": slot.o,
      } as CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={overview.icon} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    </span>
  );
}

export default function ConnectBanner() {
  const symbols = FEATURED.map((t) => `${t}B`).filter((s) => !!getStockToken(s));
  return (
    <section className="hero" aria-label="stockX">
      <div className="bubbles">
        {symbols.slice(0, SLOTS.length).map((s, i) => <Bubble key={s} symbol={s} slot={SLOTS[i]} />)}
      </div>
      <div className="hero-copy">
        <h1>Own stocks on-chain.</h1>
        <p>Swap USDT for tokenized shares.</p>
      </div>
    </section>
  );
}
