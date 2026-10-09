import { FIRST_STOCK } from "@stockx/shared";
import MarketBanner from "../components/MarketBanner";
import MarketsList from "../components/MarketsList";

export default function Home() {
  return (
    <main>
      <div className="lede">
        <h1>Swap tokenized stocks</h1>
        <p>On BNB Chain. {FIRST_STOCK.token} first. stockX only quotes and swaps. It does not mint or hold the share.</p>
      </div>
      <MarketBanner />
      <MarketsList />
    </main>
  );
}
