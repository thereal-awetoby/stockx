"use client";
import { STOCKS } from "@stockx/shared";

/** What a visitor sees before connecting: a short pitch and one clear action. */
export default function ConnectBanner() {
  return (
    <section className="hero" aria-label="stockX">
      <div className="hero-copy">
        <span className="hero-kicker">Tokenized stocks on BNB Chain</span>
        <h1>Own Apple, Nvidia and {Math.max(STOCKS.length - 2, 0)} more stocks, on-chain.</h1>
        <p>Swap USDT for tokenized shares in seconds, any time of day. Your wallet, your keys.</p>
        <div className="hero-actions">
          <button type="button" onClick={() => window.dispatchEvent(new Event("stockx:connect"))}>Connect wallet</button>
          <span className="hero-note">or browse the market below</span>
        </div>
      </div>
      <ul className="hero-stats">
        <li><strong>{STOCKS.length}</strong><span>stocks and ETFs</span></li>
        <li><strong>24/7</strong><span>on-chain trading</span></li>
        <li><strong>Self-custody</strong><span>you hold the keys</span></li>
      </ul>
    </section>
  );
}
