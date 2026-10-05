import ConnectButton from "./ConnectButton";

export default function Header() {
  return (
    <header className="header">
      <strong className="logo">stockX</strong>
      <ConnectButton />
    </header>
  );
}