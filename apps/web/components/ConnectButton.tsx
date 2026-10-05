"use client";
import { useState } from "react";
import { bsc } from "wagmi/chains";
import {
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  useSwitchChain,
} from "wagmi";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const connectors = useConnectors();
  const { connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    const wrongNetwork = chainId !== bsc.id;
    return (
      <div className="wallet">
        {wrongNetwork && (
          <button onClick={() => switchChain({ chainId: bsc.id })} disabled={switching}>
            {switching ? "Switching…" : "Switch to BNB Chain"}
          </button>
        )}
        <span className="pill open" title={address}>{short(address)}</span>
        <button className="ghost" onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  return (
    <div className="wallet">
      <button onClick={() => setOpen((o) => !o)} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {open && (
        <div className="menu">
          {connectors.length === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              No browser wallet found. Install Binance Wallet or MetaMask.
            </div>
          )}
          {connectors.map((c) => (
            <button
              key={c.uid}
              className="ghost"
              onClick={() => {
                connect({ connector: c, chainId: bsc.id });
                setOpen(false);
              }}
            >
              {c.name}
            </button>
          ))}
          {error && <div className="err">{error.message.slice(0, 120)}</div>}
        </div>
      )}
    </div>
  );
}