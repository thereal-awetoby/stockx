import { FIRST_STOCK } from "@stockx/shared";
import MarketBanner from "../components/MarketBanner";
import SwapSmokeTest from "../components/SwapSmokeTest";

export default function Home() {
  return (
    <main>
    
      <p className="sub">
        Swap tokenized stocks on BNB Chain. {FIRST_STOCK.token} first.
      </p>
      <MarketBanner />
      <SwapSmokeTest />
    </main>
  );
}
