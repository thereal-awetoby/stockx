"use client";
import { useState } from "react";
import { useOverview } from "../lib/overview";

/** Real token logo from Binance when available, otherwise the first letter. */
export default function TokenLogo({ symbol, name, size = 28, lookup = true }: { symbol: string; name?: string; size?: number; lookup?: boolean }) {
  const overview = useOverview(symbol, lookup);
  const [broken, setBroken] = useState(false);
  const url = overview?.icon;
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="logo-img" src={url} alt={name ?? symbol} width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    );
  }
  return <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>{(name ?? symbol).slice(0, 1)}</span>;
}
