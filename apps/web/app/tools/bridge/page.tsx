import BridgePanel from "../../../components/BridgePanel";

export default function BridgePage() {
  return (
    <main className="convert-page">
      <div className="lede"><h1>Bridge</h1><p>Move cash between BNB Chain and Ethereum, so you can buy stocks on either.</p></div>
      <div className="convert-wrap"><BridgePanel /></div>
    </main>
  );
}
