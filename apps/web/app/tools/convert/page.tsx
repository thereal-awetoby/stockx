import ConvertPanel from "../../../components/ConvertPanel";

export default function ConvertPage() {
  return (
    <main>
      <div className="lede"><h1>Convert</h1><p>Swap one stock token for another, in two clear steps through USDT.</p></div>
      <div style={{ maxWidth: 440 }}><ConvertPanel /></div>
    </main>
  );
}
