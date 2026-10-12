"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance, useChainId, usePublicClient, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { erc20Abi, type PublicClient, type WalletClient } from "viem";
import {
  bridgeSource,
  bridgeTarget,
  CHAINS,
  describeBridge,
  executeBridge,
  formatUnitsStr,
  parseUnitsStr,
  type BridgeBuilt,
  type BridgeStep,
  type BridgeTarget,
  type ChainKey,
} from "@stockx/shared";
import { createViemExecutor } from "../lib/viem-executor";
import { formatBalance, fractionOfBalance } from "../lib/amount";
import { recordTrade } from "../lib/trade-log";

const LIVE = process.env.NEXT_PUBLIC_LIVE_SWAPS === "1";
const QUOTE_TTL_S = 60;
const fmt = (s: string, dp = 6) => Number(s).toLocaleString("en-US", { maximumFractionDigits: dp });
const STEP_LABEL: Record<BridgeStep, string> = {
  approving: "Approve the token in your wallet…",
  "approval-confirmed": "Approval confirmed.",
  rebuilding: "Refreshing the quote…",
  sending: "Confirm the bridge in your wallet…",
  sent: "Bridge sent.",
};

type Stage = "idle" | "sending" | "sent";
type Track = { status: string; substatus: string | null; receivingTx: string | null };

export default function BridgePanel() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const [from, setFrom] = useState<ChainKey>("bsc");
  const to: ChainKey = from === "bsc" ? "ethereum" : "bsc";
  const [target, setTarget] = useState<BridgeTarget>("cash");
  const [amount, setAmount] = useState("20");
  const src = bridgeSource(from);
  const dst = bridgeTarget(to, target);
  const fromChain = CHAINS[from];
  const toChain = CHAINS[to];
  const publicClient = usePublicClient({ chainId: fromChain.id });

  const [quote, setQuote] = useState<BridgeBuilt | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [track, setTrack] = useState<Track | null>(null);

  const balanceRead = useReadContract({
    address: src.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf",
    args: address ? [address] : undefined, chainId: fromChain.id,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const balance = balanceRead.data as bigint | undefined;
  const nativeRead = useBalance({ address, chainId: fromChain.id, query: { enabled: !!address, refetchInterval: 15_000 } });
  const noGas = isConnected && nativeRead.data !== undefined && nativeRead.data.value === 0n;
  const wrongChain = isConnected && walletChainId !== fromChain.id;
  const amountValid = /^\d+(\.\d{1,18})?$/.test(amount.trim()) && Number(amount) > 0;

  const request = useMemo(() => {
    if (!amountValid) return null;
    return { fromChain: fromChain.id, toChain: toChain.id, fromToken: src.address, toToken: dst.address, fromAmount: parseUnitsStr(amount.trim(), src.decimals) };
  }, [amountValid, amount, fromChain.id, toChain.id, src.address, src.decimals, dst.address]);

  const seq = useRef(0);
  const fetchBuilt = async (): Promise<BridgeBuilt> => {
    const qs = new URLSearchParams({ from, to, target, amount: amount.trim(), wallet: address! });
    const res = await fetch(`/api/bridge/quote?${qs}`, { cache: "no-store" });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error ?? `Bridge quote failed (HTTP ${res.status})`);
    return j as BridgeBuilt;
  };

  async function runQuote(silent: boolean) {
    if (!address || !amountValid) return;
    const id = ++seq.current;
    setLoading(true);
    if (!silent) { setQuote(null); setError(null); }
    try {
      const b = await fetchBuilt();
      if (id !== seq.current) return;
      setQuote(b); setQuotedAt(Date.now()); setNow(Date.now()); setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setQuote(null); setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }

  // Quote shortly after the amount, direction, target or wallet changes.
  useEffect(() => {
    if (stage !== "idle" || !address || !amountValid) return;
    const t = setTimeout(() => { void runQuote(false); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, from, target, address, stage]);

  useEffect(() => {
    if (!quote) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [quote]);

  const secondsLeft = quote ? Math.max(0, QUOTE_TTL_S - Math.floor((now - quotedAt) / 1000)) : 0;
  const expired = !!quote && secondsLeft === 0 && stage === "idle";
  useEffect(() => {
    if (expired && !loading) void runQuote(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  // After sending, follow the transfer until the other chain confirms it.
  useEffect(() => {
    if (stage !== "sent" || !txHash) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/bridge/status?hash=${txHash}&from=${fromChain.id}&to=${toChain.id}`, { cache: "no-store" });
        const j = (await res.json()) as Track;
        if (alive) setTrack(j);
        if (j.status === "DONE" || j.status === "FAILED") return;
      } catch { /* keep polling */ }
      if (alive) timer = setTimeout(poll, 10_000);
    };
    let timer = setTimeout(poll, 4_000);
    return () => { alive = false; clearTimeout(timer); };
  }, [stage, txHash, fromChain.id, toChain.id]);

  function reset() { setQuote(null); setError(null); }
  function pickFrom(next: ChainKey) {
    if (next === from || stage === "sending") return;
    setFrom(next); setTarget("cash"); setStage("idle"); setTxHash(null); setTrack(null); reset();
  }

  async function confirm() {
    if (!quote || !request || !publicClient || !walletClient?.account) return;
    setStage("sending"); setError(null); setProgress("Preparing…");
    try {
      const executor = createViemExecutor(publicClient as PublicClient, walletClient as WalletClient);
      const res = await executeBridge({
        executor, built: quote, request, rebuild: fetchBuilt,
        onProgress: (step, d) => { setProgress(STEP_LABEL[step]); if (d?.txHash && step === "sent") setTxHash(d.txHash); },
      });
      setTxHash(res.txHash);
      if (address) {
        const d = describeBridge(quote, src, dst);
        recordTrade(address, { t: Date.now(), side: "bridge", token: `${src.symbol} → ${dst.symbol}`, amountIn: d.send, inSym: src.symbol, amountOut: d.receiveMin, outSym: dst.symbol, txHash: res.txHash, chain: from });
      }
      setStage("sent"); setProgress(null); setQuote(null);
      void balanceRead.refetch();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/insufficient funds|exceeds the balance of the account|gas \* gas fee/i.test(m) ? `Not enough ${fromChain.native} on ${fromChain.name} to pay the network fee. Add some ${fromChain.native} first.` : m);
      setStage("idle"); setProgress(null); setQuote(null); // never reuse a quote after a failed or unclear send
    }
  }

  const view = quote ? describeBridge(quote, src, dst) : null;
  const canBridge = !!quote && !!request && !wrongChain && !noGas && !expired && stage === "idle" && LIVE && (balance === undefined || balance >= request.fromAmount);
  const done = track?.status === "DONE";
  const failed = track?.status === "FAILED";

  return (
    <div className="card ticket-card">
      <div className="seg" aria-label="Direction">
        <button type="button" className={from === "bsc" ? "on" : ""} onClick={() => pickFrom("bsc")} disabled={stage === "sending"}>BNB Chain → Ethereum</button>
        <button type="button" className={from === "ethereum" ? "on" : ""} onClick={() => pickFrom("ethereum")} disabled={stage === "sending"}>Ethereum → BNB Chain</button>
      </div>

      <div className="ticket-box">
        <div className="ticket-head">
          <span className="muted small">From {fromChain.name}</span>
          {isConnected && (
            <span className="ticket-bal small">
              <span className="muted">Balance {balance === undefined ? "…" : `${formatBalance(formatUnitsStr(balance, src.decimals), 4)} ${src.symbol}`}</span>
              {[50, 100].map((p) => (
                <button key={p} type="button" className="mini" disabled={!balance || stage === "sending"}
                  onClick={() => { setAmount(fractionOfBalance(balance!, src.decimals, p, 6)); reset(); }}>{p === 100 ? "Max" : `${p}%`}</button>
              ))}
            </span>
          )}
        </div>
        <div className="ticket-line">
          <input className="ticket-input" inputMode="decimal" value={amount} disabled={stage === "sending"}
            onChange={(e) => { setAmount(e.target.value); reset(); }} placeholder="0" aria-label={`${src.symbol} amount`} />
          <span className="chip">{src.symbol}</span>
        </div>
      </div>
      <div className="ticket-arrow" aria-hidden>↓</div>
      <div className="ticket-box">
        <span className="muted small">To {toChain.name}</span>
        <div className="ticket-line">
          <span className="ticket-out">{view ? fmt(view.receive) : "0"}</span>
          <span className="chip">{dst.symbol}</span>
        </div>
        <div className="seg" style={{ margin: "8px 0 0" }} aria-label="Receive as">
          <button type="button" className={target === "cash" ? "on" : ""} onClick={() => { setTarget("cash"); reset(); }} disabled={stage === "sending"}>{bridgeTarget(to, "cash").symbol}</button>
          <button type="button" className={target === "gas" ? "on" : ""} onClick={() => { setTarget("gas"); reset(); }} disabled={stage === "sending"}>{toChain.native} for gas</button>
        </div>
      </div>

      <p className="muted small ticket-status" role="status">
        {!isConnected ? "Connect your wallet to get a bridge quote."
          : loading ? "Finding the best route…"
          : !amountValid ? "Enter an amount."
          : wrongChain ? `Switch your wallet to ${fromChain.name}.`
          : quote ? "The quote refreshes automatically." : ""}
      </p>
      {noGas && <p className="warn small">You have no {fromChain.native} on {fromChain.name} to pay the network fee for this bridge.</p>}
      {error && <p className="err">{error}</p>}

      {quote && view && (
        <>
          <div className="row"><span className="muted">You receive at least</span><span>{fmt(view.receiveMin)} {dst.symbol}</span></div>
          <div className="row"><span className="muted">Bridge fee</span><span>{quote.feeUsd === null ? "—" : `$${quote.feeUsd.toFixed(2)}`}</span></div>
          <div className="row"><span className="muted">Gas on {fromChain.name}</span><span>{quote.gasUsd === null ? "—" : `about $${quote.gasUsd.toFixed(2)}`}</span></div>
          <div className="row"><span className="muted">Route</span><span className="small">{quote.tool}{quote.durationSec ? ` · about ${Math.max(1, Math.round(quote.durationSec / 60))} min` : ""}</span></div>
          <div className="row"><span className="muted">Quote</span><span className={expired ? "neg" : "muted"}>{expired ? "Refreshing…" : `refreshes in ${secondsLeft}s`}</span></div>
        </>
      )}

      {wrongChain && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" disabled={switching} onClick={() => void switchChainAsync({ chainId: fromChain.id })} style={{ flex: 1 }}>
            {switching ? "Switching…" : `Switch wallet to ${fromChain.name}`}
          </button>
        </div>
      )}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button disabled={!canBridge} onClick={() => void confirm()} style={{ flex: 1 }}>
          {!isConnected ? "Connect wallet to bridge" : stage === "sending" ? "Sending…" : `Bridge ${src.symbol} to ${toChain.name}`}
        </button>
      </div>
      {stage === "sending" && <p className="muted small">{progress}</p>}
      {stage === "sent" && txHash && (
        <p className={failed ? "err small" : done ? "pos small" : "muted small"}>
          {failed ? "The bridge failed. Your funds are safe: check the transaction before trying again. " : done ? `Arrived on ${toChain.name}. ` : `Sent. Waiting for ${toChain.name}${track?.substatus ? ` (${track.substatus.toLowerCase().replace(/_/g, " ")})` : ""}… `}
          <a href={`${fromChain.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">Sent transaction</a>
          {track?.receivingTx && <> · <a href={`${toChain.explorer}/tx/${track.receivingTx}`} target="_blank" rel="noreferrer">Arrival transaction</a></>}
        </p>
      )}
      {isConnected && !LIVE && <p className="warn small">Live swaps are off. Set NEXT_PUBLIC_LIVE_SWAPS=1 to send real bridges.</p>}
      <p className="muted small" style={{ margin: "8px 0 0" }}>
        Bridging is done by a third-party bridge aggregator (LI.FI). You pay gas in {fromChain.native} on {fromChain.name}, and you need some {toChain.native} on {toChain.name} to trade there. Choose “{toChain.native} for gas” once to cover that. Never retry a bridge that shows as sent: check the status first.
      </p>
    </div>
  );
}
