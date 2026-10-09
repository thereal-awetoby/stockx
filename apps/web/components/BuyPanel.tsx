"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import type { PublicClient, WalletClient } from "viem";
import {
  createBinanceProvider,
  createSwapHelper,
  fetchQuoteView,
  formatUnitsStr,
  RFQ_TTL_MS,
  TOKENS,
  type BuiltSwap,
  type ProgressStep,
  type Quote,
  type QuoteView,
  type SimulationResult,
  type Stock,
} from "@stockx/shared";
import { createViemExecutor } from "../lib/viem-executor";

const fmt = (s: string, dp = 6) => Number(s).toLocaleString(undefined, { maximumFractionDigits: dp });
const LIVE = process.env.NEXT_PUBLIC_LIVE_SWAPS === "1";

const STEP_LABEL: Record<ProgressStep, string> = {
  approving: "Approve USDT in your wallet…",
  "approval-confirmed": "Approval confirmed.",
  rebuilding: "Refreshing the quote…",
  swapping: "Confirm the swap in your wallet…",
  confirming: "Waiting for the swap to confirm…",
};

type Stage = "idle" | "review" | "sending" | "done";

export default function BuyPanel({ stock, marketOpen }: { stock: Stock; marketOpen?: boolean }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: 56 });
  const { data: walletClient } = useWalletClient();

  const [amount, setAmount] = useState("5");
  const [view, setView] = useState<QuoteView | null>(null); // read-only quote (no wallet)
  const [quote, setQuote] = useState<Quote | null>(null); // wallet-bound quote
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The provider is bound to the connected MAIN wallet. Rebuilt if the wallet changes.
  const helper = useMemo(() => {
    if (!publicClient || !walletClient?.account) return null;
    const executor = createViemExecutor(publicClient as PublicClient, walletClient as WalletClient);
    return createSwapHelper(
      createBinanceProvider({
        executor,
        wallet: "main",
        onProgress: (step, d) => {
          setProgress(STEP_LABEL[step]);
          if (step === "confirming" && d?.txHash) setTxHash(d.txHash);
        },
      }),
      { actor: "user" },
    );
  }, [publicClient, walletClient]);

  const anyQuote = quote ?? view;
  useEffect(() => {
    if (!anyQuote) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyQuote]);

  function reset() {
    setView(null); setQuote(null); setSim(null); setStage("idle"); setProgress(null); setTxHash(null); setError(null);
  }

  async function getQuote() {
    setLoading(true);
    reset();
    try {
      if (helper) {
        const q = await helper.quote({ tokenIn: "USDT", tokenOut: "AAPLB", amountIn: amount.trim(), spender: "main", receiver: "main" });
        setQuote(q);
        setSim(await helper.simulate(q)); // never offer Buy without a passing simulation
      } else {
        setView(await fetchQuoteView(amount.trim(), isConnected ? address : undefined));
      }
      setNow(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!helper || !quote) return;
    setStage("sending");
    setError(null);
    setProgress("Preparing…");
    try {
      const res = await helper.execute(quote, "main");
      setTxHash(res.txHash);
      setStage("done");
      setProgress(null);
    } catch (e) {
      setError((e as Error).message);
      setStage("idle");
      setProgress(null);
      setQuote(null); // never reuse a quote after a failed or ambiguous send
      setSim(null);
    }
  }

  const built = (quote?.raw as { built?: BuiltSwap } | undefined)?.built;
  const issuedAt = quote?.issuedAt ?? view?.quotedAt;
  const secondsLeft = issuedAt ? Math.max(0, Math.ceil((issuedAt + RFQ_TTL_MS - now) / 1000)) : 0;
  const expired = !!anyQuote && secondsLeft === 0 && stage !== "sending" && stage !== "done";
  const amountIn = built ? formatUnitsStr(BigInt(built.amountIn), TOKENS.USDT.decimals) : view?.amountIn;
  const amountOut = quote?.amountOut ?? view?.amountOut;
  const minOut = built ? formatUnitsStr(BigInt(built.minAmountOut), TOKENS.AAPLB.decimals) : null;
  const effective = amountIn && amountOut && Number(amountOut) > 0 ? Number(amountIn) / Number(amountOut) : null;
  const canBuy = !!helper && !!quote && sim?.ok === true && !expired && stage === "idle" && LIVE;

  return (
    <div className="card">
      <div className="row"><strong>Buy {stock.token}</strong><span className="muted small">Pay with USDT</span></div>

      <div className="row" style={{ gap: 8 }}>
        <input
          className="search"
          style={{ margin: 0 }}
          inputMode="decimal"
          value={amount}
          disabled={stage === "sending"}
          onChange={(e) => { setAmount(e.target.value); reset(); }}
          placeholder="USDT amount"
        />
        <button onClick={getQuote} disabled={loading || stage === "sending"}>{loading ? "Quoting…" : anyQuote ? "Refresh" : "Get quote"}</button>
      </div>
      {error && <p className="err">{error}</p>}

      {anyQuote && amountIn && amountOut && (
        <>
          <div className="row"><span className="muted">You pay</span><strong>{fmt(amountIn, 4)} USDT</strong></div>
          <div className="row"><span className="muted">You receive</span><strong>{fmt(amountOut)} {stock.token}</strong></div>
          {minOut && <div className="row"><span className="muted">Minimum (after {(built!.slippageBps / 100).toFixed(1)}% slippage)</span><span>{fmt(minOut)} {stock.token}</span></div>}
          {effective !== null && (
            <div className="row"><span className="muted">Effective price</span><span>{effective.toLocaleString(undefined, { style: "currency", currency: "USD" })}</span></div>
          )}
          <div className="row"><span className="muted">Price impact</span><span>{Number((built?.priceImpactPercent ?? view?.priceImpactPercent) ?? 0).toFixed(4)}%</span></div>
          <div className="row"><span className="muted">Route</span><span className="small">{(built?.route ?? view?.route ?? []).join(" → ")}</span></div>
          <div className="row">
            <span className="muted">Quote</span>
            <span className={expired ? "neg" : "muted"}>{expired ? "Expired. Refresh" : `fresh for ${secondsLeft}s`}</span>
          </div>
          {sim && (
            <div className="row">
              <span className="muted">Simulation</span>
              {sim.ok
                ? <span className="pos small">Passed{sim.needsApproval ? " · needs a one-time exact USDT approval" : ""}</span>
                : <span className="neg small">Failed: {sim.error}</span>}
            </div>
          )}
        </>
      )}

      {stage === "review" && quote && (
        <div className="card" style={{ marginTop: 8 }}>
          <strong>Review</strong>
          <div className="row"><span className="muted">Receiver</span><span className="small">{address} (your wallet)</span></div>
          <div className="row"><span className="muted">Pay</span><span>{fmt(amountIn!, 4)} USDT</span></div>
          <div className="row"><span className="muted">Get at least</span><span>{fmt(minOut ?? "0")} {stock.token}</span></div>
          {sim?.needsApproval && (
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              Two wallet prompts: first approve exactly {fmt(amountIn!, 4)} USDT (never unlimited), then the swap. The price is re-checked in between.
            </p>
          )}
          {marketOpen === false && (
            <p className="warn small">The US market is closed. The reference price is stale and the premium may be large. This swap still trades on-chain at the on-chain price.</p>
          )}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button onClick={confirm} disabled={expired} style={{ flex: 1 }}>Confirm buy</button>
            <button className="ghost" onClick={() => setStage("idle")} style={{ flex: 1 }}>Back</button>
          </div>
        </div>
      )}

      {stage === "sending" && <p className="muted small">{progress}</p>}
      {stage === "done" && txHash && (
        <p className="pos small">
          Done.{" "}
          <a href={`https://bscscan.com/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction</a>
        </p>
      )}
      {stage === "idle" && txHash && !error && <p className="muted small">Last transaction: <a href={`https://bscscan.com/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash.slice(0, 10)}…</a></p>}

      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button disabled={!canBuy} onClick={() => setStage("review")} style={{ flex: 1 }}>
          {!isConnected ? "Connect wallet to buy" : `Buy ${stock.token}`}
        </button>
        <button disabled className="ghost" style={{ flex: 1 }}>Sell {stock.token}</button>
      </div>
      {isConnected && !LIVE && (
        <p className="warn small">Live swaps are off. Set NEXT_PUBLIC_LIVE_SWAPS=1 after the dry run in docs/builder-a-handoff.md passes.</p>
      )}
      <p className="muted small" style={{ margin: "8px 0 0" }}>Your stock purchase is public on-chain. Nothing here hides it.</p>
    </div>
  );
}
