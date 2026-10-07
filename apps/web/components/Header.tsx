import Link from "next/link";
import ConnectButton from "./ConnectButton";

export default function Header() {
  return (
    <header className="header">
      <div style={{ display: "flex", gap: 20, alignItems: "baseline" }}>
        <Link href="/" className="logo">stockX</Link>
        <Link href="/markets" className="muted">Markets</Link>
        <Link href="/pocket" className="muted">Pocket</Link>
      </div>
      <ConnectButton />
    </header>
  );
}