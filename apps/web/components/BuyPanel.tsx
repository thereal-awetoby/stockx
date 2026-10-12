"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount, useBalance, useChainId, usePublicClient, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { erc20Abi, type PublicClient, type WalletClient } from "viem";
import {
  CHAINS,
  createBinanceProvider,
  createDexProvider,
  createSwapHelper,
  ethTokenForTicker,
  getEthTradableToken,
  type ChainKey,
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

/** Binance refuses some server locations. Say that plainly instead of showing its raw message. */
function friendlyError(e: unknown, chain: { native: string; name: string } = { native: "BNB", name: "BNB Chain" }): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/insufficient funds|exceeds the balance of the account|gas \* gas fee/i.test(m)) {
    return `Not enough ${chain.native} on ${chain.name} to pay the network fee. Add some ${chain.native} first (on the Bridge page you can turn USDT into ${chain.native} for gas).`;
  }
  if (/compliance|not available in your (region|country)|restricted/i.test(m)) {
    return "Swaps aren't available from this server's location right now (Binance restricts some regions). Prices still load. The deployed app runs in a supported region.";
  }
  return m;
}

type Stage = "idle" | "review" | "sending" | "done";
type Side = "buy" | "sell";

export default function BuyPanel({ stock }: { stock: Stock }) {
  const { address, isConnected } = useAccount();
  // Ethereum is offered when this company has a tradable Ethereum token with a clean route.
  const ethToken = useMemo(() => ethTokenForTicker(stock.ticker), [stock.ticker]);
  const [chainKey, setChainKey] = useState<ChainKey>(useSearchParams().get("chain") === "ethereum" ? "ethereum" : "bsc");
  const chain = CHAINS[chainKey];
  const onEth = chainKey === "ethereum" && !!ethToken;
  const stockSym = onEth ? ethToken!.symbol : stock.token;
  const cashSym = chain.cash.symbol;
  const publicClient = usePublicClient({ chainId: chain.id });
  const { data: walletClient } = useWalletClient();
  const walletChainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const wrongChain = isConnected && walletClient?.chain?.id !== undefined && walletClient.chain.id !== chain.id;
  const tokenInfoOf = (sym: string): { address: string; decimals: number } | undefined =>
    sym === cashSym ? chain.cash : onEth ? getEthTradableToken(sym) : getTokenInfo(sym);

  // Holdings link here with ?side=sell so a held token can be sold in one click.
  const startSell = useSearchParams().get("side") === "sell";
  const [side, setSide] = useState<Side>(startSell ? "sell" : "buy");
  const [amount, setAmount] = useState(startSell ? "0.01" : "5");
  const inSym = side === "buy" ? cashSym : stockSym;
  const outSym = side === "buy" ? stockSym : cashSym;
  const inInfo = tokenInfoOf(inSym);
  const balanceRead = useReadContract({
    address: inInfo?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: chain.id,
    query: { enabled: !!address && !!inInfo, refetchInterval: 15_000 },
  });
  const balance = balanceRead.data as bigint | undefined;
  // Every transaction needs the chain's own coin for gas. Say so before the wallet fails with a long error.
  const nativeRead = useBalance({ address, chainId: chain.id, query: { enabled: !!address, refetchInterval: 15_000 } });
  const noGas = isConnected && nativeRead.data !== undefined && nativeRead.data.value === 0n;
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
    const onProgress = (step: ProgressStep, d?: { txHash?: string }) => {
      setProgress(STEP_LABEL[step]);
      if (step === "confirming" && d?.txHash) setTxHash(d.txHash);
    };
    const provider = chainKey === "ethereum"
      ? createDexProvider({ executor, wallet: "main", chain: CHAINS.ethereum, stock: getEthTradableToken, onProgress })
      : createBinanceProvider({ executor, wallet: "main", onProgress });
    return createSwapHelper(provider, { actor: "user" });
  }, [publicClient, walletClient, chainKey]);

  const anyQuote = quote ?? view;
  useEffect(() => {
    if (!anyQuote) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyQuote]);

  function reset() {
    setView(null); setQuote(null); setSim(null); setStage("idle"); setProgress(null); setTxHash(null); setError(null);
  }

  /** Fills the amount from the wallet balance. */
  function fill(pct: number) {
    if (!inInfo || balance === undefined || stage === "sending") return;
    setAmount(fractionOfBalance(balance, inInfo.decimals, pct, side === "buy" ? 6 : 18));
    reset();
  }

  async function pickChain(next: ChainKey) {
    if (next === chainKey || stage === "sending") return;
    setChainKey(next);
    setAmount(side === "buy" ? "5" : "0.01");
    reset();
    if (isConnected && walletChainId !== CHAINS[next].id) { try { await switchChainAsync({ chainId: CHAINS[next].id }); } catch { /* the wallet button below offers it again */ } }
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
      } else if (side === "sell" || onEth) {
        throw new Error(`Connect your wallet to get a ${side} quote.`);
      } else {
        const v = await fetchQuoteView(amount.trim(), isConnected ? address : undefined, stockSym);
        if (id !== quoteSeq.current) return;
        setQuote(null); setSim(null); setView(v);
      }
      setError(null);
      setNow(Date.now());
    } catch (e) {
      if (id !== quoteSeq.current) return;
      setQuote(null); setSim(null); setView(null);
      setError(friendlyError(e, chain));
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
        recordTrade(address, { t: Date.now(), side, token: stockSym, amountIn: amountIn ?? "", inSym, amountOut: amountOut ?? "", outSym, txHash: res.txHash, chain: chainKey });
      }
      setStage("done");
      setProgress(null);
      void balanceRead.refetch();
    } catch (e) {
      setError(friendlyError(e, chain));
      setStage("idle");
      setProgress(null);
      setQuote(null); // never reuse a quote after a failed or ambiguous send
      setSim(null);
    }
  }

  const built = (quote?.raw as { built?: BuiltSwap & { slippageBps: number } } | undefined)?.built;
  const dexBuilt = onEth ? (quote?.raw as { built?: { amountIn: string; amountOut: string; slippageBps: number; route: { bestRoute?: { swaps?: { swapExchanges?: { exchange?: string }[] }[] }[]; gasCostUSD?: string } } } | undefined)?.built : undefined;
  const issuedAt = quote?.issuedAt ?? view?.quotedAt;
  const secondsLeft = issuedAt ? Math.max(0, Math.ceil((issuedAt + RFQ_TTL_MS - now) / 1000)) : 0;
  const expired = !!anyQuote && secondsLeft === 0 && stage !== "sending" && stage !== "done";
  const amountIn = built ? formatUnitsStr(BigInt(built.amountIn), tokenInfoOf(inSym)!.decimals) : view?.amountIn;
  const amountOut = quote?.amountOut ?? view?.amountOut;
  const minOut = onEth
    ? (dexBuilt ? formatUnitsStr((BigInt(dexBuilt.amountOut) * BigInt(10_000 - dexBuilt.slippageBps)) / 10_000n, tokenInfoOf(outSym)!.decimals) : null)
    : built ? formatUnitsStr(BigInt(built.minAmountOut), tokenInfoOf(outSym)!.decimals) : null;
  const slipBps = built?.slippageBps ?? dexBuilt?.slippageBps ?? 50;
  const routeNames = onEth
    ? (dexBuilt?.route.bestRoute?.[0]?.swaps?.[0]?.swapExchanges ?? []).map((x) => x.exchange ?? "").filter(Boolean)
    : (built?.route ?? view?.route ?? []);
  const impactText = onEth ? null : `${Number((built?.priceImpactPercent ?? view?.priceImpactPercent) ?? 0).toFixed(4)}%`;
  const effective =
    amountIn && amountOut && Number(amountOut) > 0 && Number(amountIn) > 0
      ? side === "buy" ? Number(amountIn) / Number(amountOut) : Number(amountOut) / Number(amountIn)
      : null;
  const canBuy = !!helper && !wrongChain && !noGas && !!quote && sim?.ok === true && !expired && stage === "idle" && LIVE;
  const amountValid = Number.isFinite(Number(amount)) && Number(amount) > 0;

  // Quote automatically shortly after the amount, side or wallet changes.
  useEffect(() => {
    if (!amountValid || stage !== "idle") return;
    if (side === "sell" && !helper) return;
    const t = setTimeout(() => { void runQuote(false); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, helper, stock.token, chainKey]);

  // Replace an expired quote with a fresh one, but never while the user is reviewing or sending.
  useEffect(() => {
    if (expired && stage === "idle" && !loading) void runQuote(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  const statusText = loading
    ? "Getting the best price…"
    : !amountValid ? "Enter an amount."
    : (side === "sell" || onEth) && !helper ? `Connect your wallet to quote a ${side}.`
    : wrongChain ? `Switch your wallet to ${chain.name}.`
    : anyQuote ? "The quote updates automatically." : "";

  return (
    <div className="card ticket-card">
      {ethToken && (
        <div className="seg" style={{ marginBottom: 8 }} aria-label="Network">
          <button type="button" className={chainKey === "bsc" ? "on" : ""} onClick={() => void pickChain("bsc")} disabled={stage === "sending"}>BNB Chain</button>
          <button type="button" className={chainKey === "ethereum" ? "on" : ""} onClick={() => void pickChain("ethereum")} disabled={stage === "sending"}>Ethereum</button>
        </div>
      )}
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
      {noGas && (
        <p className="warn small">
          You have no {chain.native} on {chain.name}, so a transaction can't be paid for.{" "}
          <Link href="/tools/bridge"><u>Bridge some</u></Link> (choose “{chain.native} for gas”) or send {chain.native} to your wallet.
        </p>
      )}
      {error && <p className="err">{error}</p>}
      {!anyQuote && !!error && amountValid && stage === "idle" && !loading && (
        <button type="button" className="ghost" onClick={() => void runQuote(false)}>Try again</button>
      )}

      {anyQuote && amountIn && amountOut && (
        <>
          {minOut && <div className="row"><span className="muted">Minimum (after {(slipBps / 100).toFixed(1)}% slippage)</span><span>{fmt(minOut)} {outSym}</span></div>}
          {effective !== null && (
            <div className="row"><span className="muted">Effective price</span><span>{effective.toLocaleString("en-US", { style: "currency", currency: "USD" })}</span></div>
          )}
          {impactText && <div className="row"><span className="muted">Price impact</span><span>{impactText}</span></div>}
          <div className="row"><span className="muted">Route</span><span className="small">{routeNames.join(" → ")}</span></div>
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
          <div className="row"><span className="muted">Receiver</span><span className="small addr-wrap">{address} (your wallet)</span></div>
          <div className="row"><span className="muted">Pay</span><span>{fmt(amountIn!, 6)} {inSym}</span></div>
          <div className="row"><span className="muted">Get at least</span><span>{fmt(minOut ?? "0")} {outSym}</span></div>
          {sim?.needsApproval && (
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              Two wallet prompts: first approve exactly {fmt(amountIn!, 6)} {inSym} (never unlimited), then the swap. The price is re-checked in between.
            </p>
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
          <a href={`${chain.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction</a>
        </p>
      )}
      {stage === "idle" && txHash && !error && <p className="muted small">Last transaction: <a href={`${chain.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash.slice(0, 10)}…</a></p>}

      {wrongChain && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" disabled={switching} onClick={() => void switchChainAsync({ chainId: chain.id })} style={{ flex: 1 }}>
            {switching ? "Switching…" : `Switch wallet to ${chain.name}`}
          </button>
        </div>
      )}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button disabled={!canBuy} onClick={() => setStage("review")} style={{ flex: 1 }}>
          {!isConnected ? `Connect wallet to ${side}` : `${side === "buy" ? "Buy" : "Sell"} ${stockSym}`}
        </button>
      </div>
      {isConnected && !LIVE && (
        <p className="warn small">Live swaps are off. Set NEXT_PUBLIC_LIVE_SWAPS=1 after the dry run in docs/builder-a-handoff.md passes.</p>
      )}
      {onEth && <p className="muted small" style={{ margin: "8px 0 0" }}>Ethereum swaps use a DEX aggregator, so the price includes pool fees and depth. Small amounts can cost more in gas than on BNB Chain. Ondo tokens may have eligibility limits in some countries.</p>}
      <p className="muted small" style={{ margin: "8px 0 0" }}>Your stock purchase is public on-chain. Nothing here hides it.</p>
    </div>
  );
}
