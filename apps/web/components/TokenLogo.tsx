"use client";
import { useState } from "react";
import { brandLogoUrl, getStockToken } from "@stockx/shared";
import SafeImg from "./SafeImg";

/** Logos for tokens that are not tokenized stocks. */
const STATIC_LOGOS: Record<string, string> = {
  USDT: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x55d398326f99059fF775485246999027B3197955/logo.png",
  BNB: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png",
};

/**
 * The company's own logo (served by our /api/logo, no Binance or chain watermark), or a letter when we have none.
 * Binance's token icon is never used: it carries a Binance mark.
 */
export default function TokenLogo({ symbol, name, size = 28 }: { symbol: string; name?: string; size?: number; lookup?: boolean }) {
  const staticUrl = STATIC_LOGOS[symbol.toUpperCase()];
  const ticker = getStockToken(symbol)?.ticker;
  const brand = ticker ? brandLogoUrl(ticker) : null;
  const [failed, setFailed] = useState(false);

  if (staticUrl && !failed) {
    return <SafeImg className="logo-img" src={staticUrl} alt={name ?? symbol} width={size} height={size} onGiveUp={() => setFailed(true)} />;
  }
  if (brand && !failed) {
    return (
      <span className="logo-brand" style={{ width: size, height: size }}>
        <SafeImg src={brand} alt={name ?? symbol} onGiveUp={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>{(name ?? symbol).slice(0, 1)}</span>;
}
