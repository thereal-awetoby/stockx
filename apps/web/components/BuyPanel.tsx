"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { erc20Abi, type PublicClient, type WalletClient } from "viem";
import {
  createBinanceProvider,
  createSwapHelper,
  fetchQuoteView,
  formatUnitsStr,
  RFQ_TTL_MS,
  getTokenInfo,
  type BuiltSwap,
  type ProgressStep,
  type Quote,
  type QuoteView,
  type SimulationResult,
  type Stock,
} from "@stockx/shared";
import { createViemExecutor } from "../lib/viem-executor";
import { formatBalance, fractionOfBalance } from "../lib/amount";
import { recordTrade } from "../lib/trade-log";

const fmt = (s: string, dp = 6) => Number(s).toLocaleString("en-US", { maximumFractionDigits: dp });
const LIVE = process.env.NEXT_PUBLIC_LIVE_SWAPS === "1";

const STEP_LABEL: Record<ProgressStep, string> = {
  approving: "Approve the token in your wallet…",
  "approval-confirmed": "Approval confirmed.",
  rebuilding: "Refreshing the quote…",
  swapping: "Confirm the swap in your wallet…",
  confirming: "Waiting for the swap to confirm…",
};

type Stage = "idle" | "review" | "sending" | "done";
type Side = "buy" | "sell";

export default function BuyPanel({ stock, marketOpen }: { stock: Stock; marketOpen?: boolean }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: 56 });
  const { data: walletClient } = useWalletClient();

  // Holdings link here with ?side=sell so a held token can be sold in one click.
  const startSell = useSearchParams().get("side") === "sell";
  const [side, setSide] = useState<Side>(startSell ? "sell" : "buy");
  const [amount, setAmount] = useState(startSell ? "0.01" : "5");
  const inSym = side === "buy" ? "USDT" : stock.token;
  const outSym = side === "buy" ? stock.token : "USDT";
  const inInfo = getTokenInfo(inSym);
  const balanceRead = useReadContract({
    address: inInfo?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: 56,
    query: { enabled: !!address && !!inInfo, refetchInterval: 15_000 },
  });
  const balance = balanceRead.data as bigint | undefined;
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

  /** Fills the amount from the wallet balance. Buys stop at the demo's 50 USDT cap, sells at what is held. */
  function fill(pct: number) {
    if (!inInfo || balance === undefined || stage === "sending") return;
    setAmount(fractionOfBalance(balance, inInfo.decimals, pct, side === "buy" ? 6 : 8, side === "buy" ? 50 : undefined));
    reset();
  }

  function switchSide(next: Side) {
    if (next === side || stage === "sending") return;
    setSide(next);
    setAmount(next === "buy" ? "5" : "0.01");
    reset();
  }

  const quoteSeq = useRef(0);

  /** Quotes the amount on screen. A silent refresh keeps the old numbers until the new ones arrive. */
  async function runQuote(silent: boolean) {
    const id = ++quoteSeq.current;
    setLoading(true);
    if (!silent) reset();
    try {
      if (helper) {
        const q = await helper.quote({ tokenIn: inSym, tokenOut: outSym, amountIn: amount.trim(), spender: "main", receiver: "main" });
        const s = await helper.simulate(q); // never offer Buy without a passing simulation
        if (id !== quoteSeq.current) return;
        setView(null); setQuote(q); setSim(s);
      } else if (side === "sell") {
        throw new Error("Connect your wallet to get a sell quote.");
      } else {
        const v = await fetchQuoteView(amount.trim(), isConnected ? address : undefined, stock.token);
        if (id !== quoteSeq.current) return;
        setQuote(null); setSim(null); setView(v);
      }
      setError(null);
      setNow(Date.now());
    } catch (e) {
      if (id !== quoteSeq.current) return;
      setQuote(null); setSim(null); setView(null);
      setError((e as Error).message);
    } finally {
      if (id === quoteSeq.current) setLoading(false);
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
      if (address && res.txHash) {
        recordTrade(address, { t: Date.now(), side, token: stock.token, amountIn: amountIn ?? "", inSym, amountOut: amountOut ?? "", outSym, txHash: res.txHash });
      }
      setStage("done");
      setProgress(null);
      void balanceRead.refetch();
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
  const amountIn = built ? formatUnitsStr(BigInt(built.amountIn), getTokenInfo(inSym)!.decimals) : view?.amountIn;
  const amountOut = quote?.amountOut ?? view?.amountOut;
  const minOut = built ? formatUnitsStr(BigInt(built.minAmountOut), getTokenInfo(outSym)!.decimals) : null;
  const effective =
    amountIn && amountOut && Number(amountOut) > 0 && Number(amountIn) > 0
      ? side === "buy" ? Number(amountIn) / Number(amountOut) : Number(amountOut) / Number(amountIn)
      : null;
  const canBuy = !!helper && !!quote && sim?.ok === true && !expired && stage === "idle" && LIVE;
  const amountValid = Number.isFinite(Number(amount)) && Number(amount) > 0;

  // Quote automatically shortly after the amount, side or wallet changes.
  useEffect(() => {
    if (!amountValid || stage !== "idle") return;
    if (side === "sell" && !helper) return;
    const t = setTimeout(() => { void runQuote(false); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, helper, stock.token]);

  // Replace an expired quote with a fresh one, but never while the user is reviewing or sending.
  useEffect(() => {
    if (expired && stage === "idle" && !loading) void runQuote(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  const statusText = loading
    ? "Getting the best price…"
    : !amountValid ? "Enter an amount."
    : side === "sell" && !helper ? "Connect your wallet to quote a sell."
    : anyQuote ? "The quote updates automatically." : "";

  return (
    <div className="card ticket-card">
      <div className="seg">
        <button type="button" className={side === "buy" ? "on" : ""} onClick={() => switchSide("buy")} disabled={stage === "sending"}>Buy</button>
        <button type="button" className={side === "sell" ? "on" : ""} onClick={() => switchSide("sell")} disabled={stage === "sending"}>Sell</button>
      </div>

      <div className="ticket-box">
        <div className="ticket-head">
          <span className="muted small">{side === "buy" ? "Spend" : "Sell"}</span>
          {isConnected && inInfo && (
            <span className="ticket-bal small">
              <span className="muted">Balance {balance === undefined ? "…" : `${formatBalance(formatUnitsStr(balance, inInfo.decimals), side === "buy" ? 4 : 6)} ${inSym}`}</span>
              {[25, 50, 100].map((p) => (
                <button key={p} type="button" className="mini" disabled={!balance || stage === "sending"} onClick={() => fill(p)}>{p === 100 ? "Max" : `${p}%`}</button>
              ))}
            </span>
          )}
        </div>
        <div className="ticket-line">
          <input
            className="ticket-input"
            inputMode="decimal"
            value={amount}
            disabled={stage === "sending"}
            onChange={(e) => { setAmount(e.target.value); reset(); }}
            placeholder="0"
            aria-label={`${inSym} amount`}
          />
          <span className="chip">{inSym}</span>
        </div>
      </div>
      <div className="ticket-arrow" aria-hidden>↓</div>
      <div className="ticket-box">
        <span className="muted small">Receive</span>
        <div className="ticket-line">
          <span className="ticket-out">{amountOut ? fmt(amountOut) : "0"}</span>
          <span className="chip">{outSym}</span>
        </div>
      </div>
      <p className="muted small ticket-status" role="status">{statusText}</p>
      {error && <p className="err">{error}</p>}
      {!anyQuote && !!error && amountValid && stage === "idle" && !loading && (
        <button type="button" className="ghost" onClick={() => void runQuote(false)}>Try again</button>
      )}

      {anyQuote && amountIn && amountOut && (
        <>
          {minOut && <div className="row"><span className="muted">Minimum (after {(built!.slippageBps / 100).toFixed(1)}% slippage)</span><span>{fmt(minOut)} {outSym}</span></div>}
          {effective !== null && (
            <div className="row"><span className="muted">Effective price</span><span>{effective.toLocaleString("en-US", { style: "currency", currency: "USD" })}</span></div>
          )}
          <div className="row"><span className="muted">Price impact</span><span>{Number((built?.priceImpactPercent ?? view?.priceImpactPercent) ?? 0).toFixed(4)}%</span></div>
          <div className="row"><span className="muted">Route</span><span className="small">{(built?.route ?? view?.route ?? []).join(" → ")}</span></div>
          <div className="row">
            <span className="muted">Quote</span>
            <span className={expired ? "neg" : "muted"}>{expired ? "Refreshing…" : `refreshes in ${secondsLeft}s`}</span>
          </div>
          {sim && (
            <div className="row">
              <span className="muted">Simulation</span>
              {sim.ok
                ? <span className="pos small">Passed{sim.needsApproval ? ` · needs a one-time exact ${inSym} approval` : ""}</span>
                : <span className="neg small">Failed: {sim.error}</span>}
            </div>
          )}
        </>
      )}

      {stage === "review" && quote && (
        <div className="card" style={{ marginTop: 8 }}>
          <strong>Review</strong>
          <div className="row"><span className="muted">Receiver</span><span className="small">{address} (your wallet)</span></div>
          <div className="row"><span className="muted">Pay</span><span>{fmt(amountIn!, 6)} {inSym}</span></div>
          <div className="row"><span className="muted">Get at least</span><span>{fmt(minOut ?? "0")} {outSym}</span></div>
          {sim?.needsApproval && (
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              Two wallet prompts: first approve exactly {fmt(amountIn!, 6)} {inSym} (never unlimited), then the swap. The price is re-checked in between.
            </p>
          )}
          {marketOpen === false && (
            <p className="warn small">The US market is closed. The reference price is stale and the premium may be large. This swap still trades on-chain at the on-chain price.</p>
          )}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button onClick={confirm} disabled={expired} style={{ flex: 1 }}>Confirm {side}</button>
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
          {!isConnected ? `Connect wallet to ${side}` : `${side === "buy" ? "Buy" : "Sell"} ${stock.token}`}
        </button>
      </div>
      {side === "sell" && <p className="muted small" style={{ margin: "8px 0 0" }}>Sells are capped at 1 {stock.token} per swap while live swaps are being tested.</p>}
      {isConnected && !LIVE && (
        <p className="warn small">Live swaps are off. Set NEXT_PUBLIC_LIVE_SWAPS=1 after the dry run in docs/builder-a-handoff.md passes.</p>
      )}
      <p className="muted small" style={{ margin: "8px 0 0" }}>Your stock purchase is public on-chain. Nothing here hides it.</p>
    </div>
  );
}
