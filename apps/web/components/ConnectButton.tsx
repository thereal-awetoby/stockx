"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { bsc } from "../lib/wagmi";

const PREFERRED = ["metamask", "rabby", "binance", "okx", "coinbase", "trust", "phantom", "rainbow", "brave", "zerion"];
const INSTALL = [
  { name: "MetaMask", url: "https://metamask.io/download" },
  { name: "Rabby", url: "https://rabby.io" },
  { name: "Binance Wallet", url: "https://www.binance.com/en/binancewallet" },
  { name: "OKX Wallet", url: "https://web3.okx.com/download" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet" },
  { name: "Trust Wallet", url: "https://trustwallet.com/download" },
];
const rank = (name: string) => { const i = PREFERRED.findIndex((p) => name.toLowerCase().includes(p)); return i === -1 ? PREFERRED.length : i; };

function WalletLogo({ name, icon }: { name: string; icon?: string }) {
  // Installed wallets announce their own logo (EIP-6963); anything without one gets its initial.
  // eslint-disable-next-line @next/next/no-img-element
  return icon ? <img className="wallet-logo" src={icon} alt="" width={28} height={28} /> : <span className="wallet-mono" aria-hidden>{name.slice(0, 1)}</span>;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const connectors = useConnectors();
  const { connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Every wallet the browser announces, best known first. The generic "Injected" entry is hidden when real ones exist.
  const wallets = useMemo(() => {
    const named = connectors.filter((c) => c.name.toLowerCase() !== "injected");
    return [...(named.length ? named : connectors)].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  }, [connectors]);
  const missing = INSTALL.filter((w) => !wallets.some((c) => c.name.toLowerCase().includes(w.name.toLowerCase().split(" ")[0]!)));

  // Lets the home banner open this menu.
  useEffect(() => {
    const openMenu = () => setOpen(true);
    window.addEventListener("stockx:connect", openMenu);
    return () => window.removeEventListener("stockx:connect", openMenu);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (isConnected && address) {
    const wrongNetwork = chainId !== bsc.id;
    return (
      <div className="wallet" ref={box}>
        {wrongNetwork && (
          <button type="button" onClick={() => switchChain({ chainId: bsc.id })} disabled={switching}>
            {switching ? "Switching…" : "Switch to BNB Chain"}
          </button>
        )}
        <button type="button" className="wallet-btn" aria-haspopup="menu" aria-expanded={open} title={address} onClick={() => setOpen((v) => !v)}>
          <span className="wallet-dot" aria-hidden />
          {short(address)}
          <span aria-hidden>▾</span>
        </button>
        {open && (
          <div className="menu wallet-menu" role="menu">
            <div className="wallet-head">
              <strong>{short(address)}</strong>
              <span className="muted small">{wrongNetwork ? "Wrong network" : "BNB Chain"}</span>
            </div>
            <button
              type="button"
              className="menu-item"
              onClick={async () => {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => { setCopied(false); setOpen(false); }, 800);
              }}
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            <a className="menu-item" href={`https://bscscan.com/address/${address}`} target="_blank" rel="noreferrer">View on explorer</a>
            <button type="button" className="menu-item" onClick={() => { disconnect(); setOpen(false); }}>Disconnect wallet</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet" ref={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect"}
      </button>
      {open && (
        <div className="menu wallet-menu wallet-list" role="menu">
          <div className="wallet-title">Connect a wallet</div>
          {wallets.length === 0 && <div className="muted small" style={{ padding: "4px 16px 10px" }}>No browser wallet detected.</div>}
          {wallets.map((c) => (
            <button key={c.uid} type="button" className="menu-item wallet-item" onClick={() => { connect({ connector: c, chainId: bsc.id }); setOpen(false); }}>
              <WalletLogo name={c.name} icon={c.icon} />
              <span>{c.name}</span>
            </button>
          ))}
          {missing.length > 0 && (
            <>
              <div className="wallet-title wallet-sub">Don&apos;t have one? Get a wallet</div>
              {missing.map((w) => (
                <a key={w.name} className="menu-item wallet-item" href={w.url} target="_blank" rel="noreferrer">
                  <WalletLogo name={w.name} />
                  <span>{w.name}</span>
                  <span className="muted small" style={{ marginLeft: "auto" }}>Install ↗</span>
                </a>
              ))}
            </>
          )}
          {error && <div className="err" style={{ padding: "6px 16px" }}>{error.message.slice(0, 120)}</div>}
        </div>
      )}
    </div>
  );
}
