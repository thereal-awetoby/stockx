"use client";
import Link from "next/link";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { TOKENS } from "@stockx/shared";

const fmt = (s: string, dp = 6) => Number(s).toLocaleString(undefined, { maximumFractionDigits: dp });

function Erc20Row({ symbol, address, decimals, owner }: { symbol: string; address: Address; decimals: number; owner: Address }) {
  const { data, error, isLoading } = useReadContract({
    address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
    chainId: 56,
    query: { refetchInterval: 20_000 },
  });
  return (
    <tr>
      <td>Main</td>
      <td>{symbol}</td>
      <td>{error ? <span className="neg">unavailable</span> : isLoading || data === undefined ? "…" : fmt(formatUnits(data, decimals))}</td>
    </tr>
  );
}

export default function PortfolioView() {
  const { address, isConnected } = useAccount();
  const bnb = useBalance({ address, chainId: 56, query: { enabled: !!address, refetchInterval: 20_000 } });

  if (!isConnected || !address) {
    return <div className="card muted">Connect your wallet to see balances.</div>;
  }
  return (
    <>
      <section className="sheet sheet-scroll">
        <table>
          <thead><tr><th>Wallet</th><th>Asset</th><th>Amount</th></tr></thead>
          <tbody>
            <Erc20Row symbol="USDT" address={TOKENS.USDT.address} decimals={TOKENS.USDT.decimals} owner={address} />
            <Erc20Row symbol="AAPLB" address={TOKENS.AAPLB.address} decimals={TOKENS.AAPLB.decimals} owner={address} />
            <tr>
              <td>Main</td>
              <td>BNB</td>
              <td>{bnb.error ? <span className="neg">unavailable</span> : bnb.data ? fmt(bnb.data.formatted) : "…"}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p className="muted small" style={{ marginTop: 12 }}>
        Pocket balances and agent activity are on the <Link href="/pocket"><u>Pocket page</u></Link>. Trade history is not built yet.
      </p>
    </>
  );
}
