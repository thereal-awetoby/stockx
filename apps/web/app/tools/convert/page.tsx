import ConvertPanel from "../../../components/ConvertPanel";

export default function ConvertPage() {
  return (
    <main className="convert-page">
      <div className="lede"><h1>Convert</h1><p>Swap one stock token for another in a single swap.</p></div>
      <div className="convert-wrap"><ConvertPanel /></div>
    </main>
  );
}
