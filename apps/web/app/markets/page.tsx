import MarketsList from "../../components/MarketsList";

export default function MarketsPage() {
  return (
    <main>
      <h1>Markets</h1>
      <p className="sub">Tokenized stocks on BNB Chain.</p>
      <MarketsList />
    </main>
  );
}