"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { erc20Abi, type PublicClient, type WalletClient } from "viem";
import {
  createBinanceProvider,
  createSwapHelper,
  fetchQuoteView,
  formatUnitsStr,
  getTokenInfo,
  RFQ_TTL_MS,
  STOCKS,
  type ProgressStep,
  type Quote,
  type SimulationResult,
} from "@stockx/shared";
import { createViemExecutor } from "../lib/viem-executor";
import { formatBalance, fractionOfBalance } from "../lib/amount";
import { recordTrade } from "../lib/trade-log";
import TokenSelect from "./TokenSelect";

const LIVE = process.env.NEXT_PUBLIC_LIVE_SWAPS === "1";
const fmt = (s: string, dp = 6) => Number(s).toLocaleString("en-US", { maximumFractionDigits: dp });
const STEP_LABEL: Record<ProgressStep, string> = {
  approving: "Approve the token in your wallet…",
  "approval-confirmed": "Approval confirmed.",
  rebuilding: "Refreshing the quote…",
  swapping: "Confirm the swap in your wallet…",
  confirming: "Waiting for the swap to confirm…",
};
function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/compliance|not available in your (region|country)|restricted/i.test(m)) {
    return "Swaps aren't available from this server's location right now (Binance restricts some regions). Prices still load. The deployed app runs in a supported region.";
  }
  return m;
}

/** One leg: quote + simulate on screen, then a wallet confirmation. */
interface Leg { quote: Quote; sim: SimulationResult }
type Mode = "direct" | "usdt";
type Phase = "idle" | "sending1" | "between" | "sending2" | "done";

export default function ConvertPanel() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: 56 });
  const { data: walletClient } = useWalletClient();

  const tokens = useMemo(() => STOCKS.filter((s) => s.address).map((s) => s.token), []);
  const [from, setFrom] = useState(tokens.includes("AAPLB") ? "AAPLB" : tokens[0] ?? "");
  const [to, setTo] = useState(tokens.find((t) => t !== "AAPLB") ?? "");
  const [amount, setAmount] = useState("");
  const [leg1, setLeg1] = useState<Leg | null>(null);
  const [leg2, setLeg2] = useState<Leg | null>(null);
  const [estimate, setEstimate] = useState<string | null>(null); // USDT from leg 1
  const [estimateOut, setEstimateOut] = useState<string | null>(null); // target token, rough
  const [mode, setMode] = useState<Mode>("direct");
  const [directFailed, setDirectFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash1, setHash1] = useState<string | null>(null);
  const [hash2, setHash2] = useState<string | null>(null);
  const [received, setReceived] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fromInfo = getTokenInfo(from);
  const usdt = getTokenInfo("USDT");
  const balanceRead = useReadContract({
    address: fromInfo?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: 56,
    query: { enabled: !!address && !!fromInfo, refetchInterval: 15_000 },
  });
  const balance = balanceRead.data as bigint | undefined;

  const helper = useMemo(() => {
    if (!publicClient || !walletClient?.account) return null;
    const executor = createViemExecutor(publicClient as PublicClient, walletClient as WalletClient);
    return createSwapHelper(
      createBinanceProvider({ executor, wallet: "main", onProgress: (step) => setProgress(STEP_LABEL[step]) }),
      { actor: "user" },
    );
  }, [publicClient, walletClient]);

  const amountValid = /^\d+(\.\d{1,18})?$/.test(amount.trim()) && Number(amount) > 0;
  const sameToken = from === to;
  const busy = phase === "sending1" || phase === "sending2";
  const seq = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  function resetAll() {
    setLeg1(null); setLeg2(null); setEstimate(null); setEstimateOut(null);
    setPhase("idle"); setProgress(null); setError(null); setHash1(null); setHash2(null); setReceived(null); setMode("direct"); setDirectFailed(false);
  }

  /** Quote for the amount on screen: one direct swap, or (opt-in) sell for USDT with a read-only estimate of the buy. */
  async function quoteLeg1() {
    if (!helper || !amountValid || sameToken || !to) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const q = await helper.quote({ tokenIn: from, tokenOut: mode === "direct" ? to : "USDT", amountIn: amount.trim(), spender: "main", receiver: "main" });
      const s = await helper.simulate(q);
      if (id !== seq.current) return;
      setLeg1({ quote: q, sim: s });
      setError(null); setDirectFailed(false);
      setNow(Date.now());
      if (mode === "direct") { setEstimate(null); setEstimateOut(q.amountOut); return; }
      setEstimate(q.amountOut);
      try {
        const usdtIn = Number(q.amountOut).toFixed(6).replace(/\.?0+$/, "");
        if (Number(usdtIn) > 0) {
          const v = await fetchQuoteView(usdtIn, address, to);
          if (id === seq.current) setEstimateOut(v.amountOut);
        }
      } catch { if (id === seq.current) setEstimateOut(null); }
    } catch (e) {
      if (id !== seq.current) return;
      setLeg1(null); setEstimate(null); setEstimateOut(null);
      setError(friendlyError(e));
      if (mode === "direct") setDirectFailed(true);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }

  // Quote automatically after the amount, tokens or wallet change.
  useEffect(() => {
    if (phase !== "idle") return;
    setLeg1(null); setEstimate(null); setEstimateOut(null);
    if (!helper || !amountValid || sameToken) { setError(null); return; }
    const t = setTimeout(() => { void quoteLeg1(); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, from, to, helper, mode]);

  const issued1 = leg1?.quote.issuedAt;
  const left1 = issued1 ? Math.max(0, Math.ceil((issued1 + RFQ_TTL_MS - now) / 1000)) : 0;
  const expired1 = !!leg1 && left1 === 0 && phase === "idle";
  useEffect(() => {
    if (expired1 && !loading) void quoteLeg1();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired1]);

  /** USDT balance of the wallet, read straight from the chain. */
  async function readUsdt(): Promise<bigint> {
    if (!publicClient || !usdt || !address) throw new Error("Wallet not ready.");
    return (await publicClient.readContract({ address: usdt.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [address] })) as bigint;
  }

  /** Second swap quote: buy `to` with exactly the USDT the first swap delivered. Throws on failure. */
  async function quoteLeg2(usdtAmount: string): Promise<Leg> {
    if (!helper) throw new Error("Wallet not ready.");
    const q = await helper.quote({ tokenIn: "USDT", tokenOut: to, amountIn: usdtAmount, spender: "main", receiver: "main" });
    const s = await helper.simulate(q);
    if (!s.ok) throw new Error(s.error ?? "Simulation failed.");
    return { quote: q, sim: s };
  }

  /** USDT amount cut to 6 decimals. */
  function spendFrom(usdtText: string): string {
    const [w = "0", f = ""] = usdtText.split(".");
    return f.slice(0, 6) ? `${w}.${f.slice(0, 6)}` : w;
  }

  /** One click: sell, then buy with what arrived, with no second click in between. */
  async function convert() {
    if (!helper || !leg1 || !address || !LIVE) return;
    setPhase("sending1"); setError(null); setProgress(`Selling ${from}…`);
    if (mode === "direct") {
      setPhase("sending1"); setError(null); setProgress(`Converting ${from} to ${to}…`);
      try {
        const res = await helper.execute(leg1.quote, "main");
        setHash1(res.txHash);
        if (res.txHash) recordTrade(address, { t: Date.now(), side: "sell", token: from, amountIn: amount.trim(), inSym: from, amountOut: leg1.quote.amountOut, outSym: to, txHash: res.txHash });
        setPhase("done"); setProgress(null);
        void balanceRead.refetch();
      } catch (e) {
        setError(friendlyError(e)); setPhase("idle"); setProgress(null); setLeg1(null);
      }
      return;
    }
    let sold = false; // once the sell is on-chain it is never repeated
    try {
      const before = await readUsdt();
      const res = await helper.execute(leg1.quote, "main");
      sold = true;
      setHash1(res.txHash);
      const after = await readUsdt();
      const gained = after > before ? after - before : 0n;
      const usdtText = usdt ? formatUnitsStr(gained, usdt.decimals) : "0";
      if (res.txHash) recordTrade(address, { t: Date.now(), side: "sell", token: from, amountIn: amount.trim(), inSym: from, amountOut: usdtText, outSym: "USDT", txHash: res.txHash });
      void balanceRead.refetch();
      if (gained <= 0n) throw new Error("The sell confirmed but no USDT arrived yet.");
      setReceived(usdtText);
      setPhase("sending2"); setProgress(`Buying ${to}…`);
      const spend = spendFrom(usdtText);
      const l2 = await quoteLeg2(spend);
      setLeg2(l2);
      const res2 = await helper.execute(l2.quote, "main");
      setHash2(res2.txHash);
      if (res2.txHash) recordTrade(address, { t: Date.now(), side: "buy", token: to, amountIn: spend, inSym: "USDT", amountOut: l2.quote.amountOut, outSym: to, txHash: res2.txHash });
      setPhase("done"); setProgress(null);
      void balanceRead.refetch();
    } catch (e) {
      const msg = friendlyError(e);
      setProgress(null);
      setLeg1(null); setLeg2(null);
      if (sold) {
        setPhase("between");
        setError(`${msg} Your ${from} was sold and the USDT is safe in your wallet. Use Finish to buy ${to}.`);
      } else {
        setPhase("idle");
        setError(msg);
      }
    }
  }

  /** Only after a failure in the middle: buy the target with the USDT that arrived. */
  async function finish() {
    if (!helper || !address || !received) return;
    setPhase("sending2"); setError(null); setProgress(`Buying ${to}…`);
    try {
      const spend = spendFrom(received);
      const l2 = await quoteLeg2(spend);
      const res2 = await helper.execute(l2.quote, "main");
      setHash2(res2.txHash);
      if (res2.txHash) recordTrade(address, { t: Date.now(), side: "buy", token: to, amountIn: spend, inSym: "USDT", amountOut: l2.quote.amountOut, outSym: to, txHash: res2.txHash });
      setPhase("done"); setProgress(null);
      void balanceRead.refetch();
    } catch (e) {
      setError(friendlyError(e)); setPhase("between"); setProgress(null);
    }
  }

  function fill(pct: number) {
    if (!fromInfo || balance === undefined || busy) return;
    setAmount(fractionOfBalance(balance, fromInfo.decimals, pct, 18));
  }
  function flip() {
    if (busy || phase !== "idle") return;
    setFrom(to); setTo(from);
  }

  const canStart = !!helper && !!leg1 && leg1.sim.ok && !expired1 && phase === "idle" && LIVE && !sameToken;
  const statusText = loading ? "Getting the best prices…"
    : sameToken ? "Pick two different stocks."
    : !amountValid ? "Enter an amount."
    : !helper ? "Connect your wallet to see a quote."
    : leg1 ? "Quotes update automatically." : "";

  return (
    <div className="card ticket-card convert">
      <div className="ticket-box">
        <div className="ticket-head">
          <span className="muted small">From</span>
          {isConnected && fromInfo && (
            <span className="ticket-bal small">
              <span className="muted">Balance {balance === undefined ? "…" : `${formatBalance(formatUnitsStr(balance, fromInfo.decimals), 6)} ${from}`}</span>
              {[25, 50, 100].map((p) => (
                <button key={p} type="button" className="mini" disabled={!balance || busy || phase !== "idle"} onClick={() => fill(p)}>{p === 100 ? "Max" : `${p}%`}</button>
              ))}
            </span>
          )}
        </div>
        <div className="ticket-line">
          <input className="ticket-input" inputMode="decimal" value={amount} disabled={busy || phase !== "idle"}
            onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-label={`${from} amount`} />
          <TokenSelect value={from} exclude={to} onChange={setFrom} disabled={busy || phase !== "idle"} label="From token" />
        </div>
      </div>
      <button type="button" className="ticket-arrow flipbtn" onClick={flip} disabled={busy || phase !== "idle"} aria-label="Swap direction">↓↑</button>
      <div className="ticket-box">
        <span className="muted small">To (about)</span>
        <div className="ticket-line">
          <span className="ticket-out">{estimateOut ? fmt(estimateOut) : "0"}</span>
          <TokenSelect value={to} exclude={from} onChange={setTo} disabled={busy || phase !== "idle"} label="To token" />
        </div>
      </div>
      <p className="muted small ticket-status" role="status">{statusText}</p>
      {error && <p className="err">{error}</p>}
      {directFailed && phase === "idle" && !loading && (
        <button type="button" className="ghost" onClick={() => { setMode("usdt"); setDirectFailed(false); setError(null); }}>No direct route. Route through USDT instead (two swaps)</button>
      )}

      {leg1 && phase === "idle" && (
        <>
          <div className="row"><span className="muted">Route</span><span className="small">{mode === "direct" ? `${from} → ${to} (one swap)` : `${from} → USDT → ${to}`}</span></div>
          <div className="row"><span className="muted">Quote</span><span className="muted">{leg1.sim.ok ? `refreshes in ${left1}s` : `simulation failed: ${leg1.sim.error}`}</span></div>
        </>
      )}
      {busy && <p className="muted small">{progress}</p>}
      {(hash1 || hash2) && (
        <p className="small">
          {hash1 && <a href={`https://bscscan.com/tx/${hash1}`} target="_blank" rel="noreferrer">Sell transaction</a>}
          {hash1 && hash2 && " · "}
          {hash2 && <a href={`https://bscscan.com/tx/${hash2}`} target="_blank" rel="noreferrer">Buy transaction</a>}
        </p>
      )}
      {phase === "done" && <p className="pos small">Converted. Both trades are public on-chain and saved in Portfolio.</p>}

      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        {phase === "done" ? (
          <button className="ghost" onClick={resetAll} style={{ flex: 1 }}>Convert again</button>
        ) : phase === "between" ? (
          <button onClick={() => void finish()} style={{ flex: 1 }}>Finish: buy {to}</button>
        ) : (
          <button disabled={!canStart || busy} onClick={() => void convert()} style={{ flex: 1 }}>
            {!isConnected ? "Connect wallet to convert" : busy ? "Converting…" : `Convert ${from} to ${to}`}
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: "8px 0 0" }}>
        {mode === "direct"
          ? "One swap straight from stock to stock, simulated first, one wallet confirmation (plus a one-time exact approval if needed)."
          : "Routed through USDT: two swaps, so your wallet asks you to confirm twice. If the second fails your USDT stays in your wallet."}{" "}
        Trades are public on-chain.
      </p>
      {isConnected && !LIVE && <p className="warn small">Live swaps are off. Set NEXT_PUBLIC_LIVE_SWAPS=1.</p>}
    </div>
  );
}
