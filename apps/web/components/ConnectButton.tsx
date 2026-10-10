"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { bsc } from "../lib/wagmi";

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
        <div className="menu wallet-menu" role="menu">
          {connectors.length === 0 && (
            <div className="muted small" style={{ padding: 12 }}>No browser wallet found. Install Binance Wallet or MetaMask.</div>
          )}
          {connectors.map((c) => (
            <button key={c.uid} type="button" className="menu-item" onClick={() => { connect({ connector: c, chainId: bsc.id }); setOpen(false); }}>
              {c.name}
            </button>
          ))}
          {error && <div className="err" style={{ padding: "6px 12px" }}>{error.message.slice(0, 120)}</div>}
        </div>
      )}
    </div>
  );
}
