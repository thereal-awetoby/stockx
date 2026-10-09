import SwapSmokeTest from "../../components/SwapSmokeTest";

/** The mock-pipeline smoke test used to live on the home page. Kept here for developers. */
export default function DevPage() {
  return (
    <main>
      <div className="lede"><h1>Dev</h1><p>Mock swap pipeline smoke test. No real funds.</p></div>
      <SwapSmokeTest />
    </main>
  );
}
