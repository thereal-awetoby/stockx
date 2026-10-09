import MarketsList from "../../components/MarketsList";

export default function MarketsPage() {
  return (
    <main>
      <div className="lede">
        <h1>Explore</h1>
        <p>Tokenized stocks on BNB Chain. Prices come from Binance Web3 RWA data.</p>
      </div>
      <MarketsList />
    </main>
  );
}
