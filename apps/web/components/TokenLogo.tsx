"use client";
import { useState } from "react";
import { brandLogoUrl, getStockToken } from "@stockx/shared";
import { useOverview } from "../lib/overview";
import SafeImg from "./SafeImg";

/**
 * Known logos for tokens that aren't tokenized stocks, so the Binance RWA
 * lookup (which only resolves our stock-token registry) can never find them.
 */
const STATIC_LOGOS: Record<string, string> = {
  USDT: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x55d398326f99059fF775485246999027B3197955/logo.png",
  BNB: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png",
};

/** Real token logo from Binance (or a known static logo) when available, otherwise the first letter. */
export default function TokenLogo({ symbol, name, size = 28, lookup = true }: { symbol: string; name?: string; size?: number; lookup?: boolean }) {
  const staticUrl = STATIC_LOGOS[symbol.toUpperCase()];
  // The company's own logo comes first: it has no chain watermark. The token icon is only a fallback.
  const ticker = getStockToken(symbol)?.ticker;
  const brand = ticker ? brandLogoUrl(ticker) : null;
  const [brandFailed, setBrandFailed] = useState(false);
  const useBrand = !!brand && !brandFailed;
  const overview = useOverview(symbol, lookup && !staticUrl && !useBrand);
  const [broken, setBroken] = useState(false);
  if (useBrand) {
    return (
      <span className="logo-brand" style={{ width: size, height: size }}>
        <SafeImg src={brand!} alt={name ?? symbol} onGiveUp={() => setBrandFailed(true)} />
      </span>
    );
  }
  const url = staticUrl ?? overview?.icon;
  if (url && !broken) {
    return (
      <SafeImg className="logo-img" src={url} alt={name ?? symbol} width={size} height={size} onGiveUp={() => setBroken(true)} />
    );
  }
  return <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>{(name ?? symbol).slice(0, 1)}</span>;
}
