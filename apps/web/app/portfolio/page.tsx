import PortfolioView from "../../components/PortfolioView";

export default function PortfolioPage() {
  return (
    <main>
      <div className="lede">
        <h1>Portfolio</h1>
        <p>Balances in the wallet you connected. The session pocket is separate and lives on the Pocket page.</p>
      </div>
      <PortfolioView />
    </main>
  );
}
