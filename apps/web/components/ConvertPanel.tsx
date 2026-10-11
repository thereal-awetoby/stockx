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
import TokenLogo from "./TokenLogo";

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
type Phase = "idle" | "sending1" | "between" | "sending2" | "done";

export default function ConvertPanel() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: 56 });
  const { data: walletClient } = useWalletClient();

  const tokens = useMemo(() => STOCKS.filter((s) => s.address).map((s) => s.token), []);
  const [from, setFrom] = useState(tokens.includes("AAPLB") ? "AAPLB" : tokens[0] ?? "");
  const [to, setTo] = useState(tokens.find((t) => t !== "AAPLB") ?? "");
  const [amount, setAmount] = useState("0.01");
  const [leg1, setLeg1] = useState<Leg | null>(null);
  const [leg2, setLeg2] = useState<Leg | null>(null);
  const [estimate, setEstimate] = useState<string | null>(null); // USDT from leg 1
  const [estimateOut, setEstimateOut] = useState<string | null>(null); // target token, rough
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

  const amountValid = /^\d+(\.\d{1,18})?$/.test(amount.trim()) && Number(amount) > 0 && Number(amount) <= 1;
  const sameToken = from === to;
  const busy = phase === "sending1" || phase === "sending2";
  const seq = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  function resetAll() {
    setLeg1(null); setLeg2(null); setEstimate(null); setEstimateOut(null);
    setPhase("idle"); setProgress(null); setError(null); setHash1(null); setHash2(null); setReceived(null);
  }

  /** Step 1 quote (sell `from` for USDT) plus a read-only estimate of step 2. */
  async function quoteLeg1() {
    if (!helper || !amountValid || sameToken || !to) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const q = await helper.quote({ tokenIn: from, tokenOut: "USDT", amountIn: amount.trim(), spender: "main", receiver: "main" });
      const s = await helper.simulate(q);
      if (id !== seq.current) return;
      setLeg1({ quote: q, sim: s });
      setEstimate(q.amountOut);
      setError(null);
      setNow(Date.now());
      // Rough second leg, read-only, so the user sees where the money ends up before starting.
      try {
        const usdtIn = Number(q.amountOut).toFixed(6).replace(/\.?0+$/, "");
        if (Number(usdtIn) > 0 && Number(usdtIn) <= 50) {
          const v = await fetchQuoteView(usdtIn, address, to);
          if (id === seq.current) setEstimateOut(v.amountOut);
        }
      } catch { if (id === seq.current) setEstimateOut(null); }
    } catch (e) {
      if (id !== seq.current) return;
      setLeg1(null); setEstimate(null); setEstimateOut(null);
      setError(friendlyError(e));
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
  }, [amount, from, to, helper]);

  const issued1 = leg1?.quote.issuedAt;
  const left1 = issued1 ? Math.max(0, Math.ceil((issued1 + RFQ_TTL_MS - now) / 1000)) : 0;
  const expired1 = !!leg1 && left1 === 0 && phase === "idle";
  useEffect(() => {
    if (expired1 && !loading) void quoteLeg1();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired1]);

  const issued2 = leg2?.quote.issuedAt;
  const left2 = issued2 ? Math.max(0, Math.ceil((issued2 + RFQ_TTL_MS - now) / 1000)) : 0;
  const expired2 = !!leg2 && left2 === 0 && phase === "between";

  /** USDT balance of the wallet, read straight from the chain. */
  async function readUsdt(): Promise<bigint> {
    if (!publicClient || !usdt || !address) throw new Error("Wallet not ready.");
    return (await publicClient.readContract({ address: usdt.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [address] })) as bigint;
  }

  /** Step 2 quote: buy `to` with exactly the USDT that step 1 delivered. */
  async function quoteLeg2(usdtAmount: string) {
    if (!helper) return;
    setLoading(true);
    try {
      const q = await helper.quote({ tokenIn: "USDT", tokenOut: to, amountIn: usdtAmount, spender: "main", receiver: "main" });
      const s = await helper.simulate(q);
      setLeg2({ quote: q, sim: s });
      setError(null);
      setNow(Date.now());
    } catch (e) {
      setLeg2(null);
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  async function runStep1() {
    if (!helper || !leg1 || !address || !LIVE) return;
    setPhase("sending1"); setError(null); setProgress("Preparing step 1…");
    let sold = false; // true once the sell is on-chain, so a later hiccup never restarts step 1
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
      if (gained <= 0n) throw new Error("Step 1 confirmed but no USDT arrived yet. Check the transaction, then use Refresh step 2.");
      setReceived(usdtText);
      setPhase("between"); setProgress(null);
      // Step 2 spends what actually arrived, cut to 6 decimals and capped at the demo limit of 50 USDT.
      const [w = "0", f = ""] = usdtText.split(".");
      const spend = Math.min(50, Number(`${w}.${f.slice(0, 6) || "0"}`));
      if (spend > 0) await quoteLeg2(String(spend));
    } catch (e) {
      setError(friendlyError(e));
      // If the sell went through but we could not move on, stay on step 2 so nothing is lost or repeated.
      setPhase(sold ? "between" : "idle");
      setProgress(null);
      setLeg1(null);
    }
  }

  async function runStep2() {
    if (!helper || !leg2 || !address || !LIVE) return;
    setPhase("sending2"); setError(null); setProgress("Preparing step 2…");
    try {
      const res = await helper.execute(leg2.quote, "main");
      setHash2(res.txHash);
      if (res.txHash) recordTrade(address, { t: Date.now(), side: "buy", token: to, amountIn: leg2.quote.request.amountIn, inSym: "USDT", amountOut: leg2.quote.amountOut, outSym: to, txHash: res.txHash });
      setPhase("done"); setProgress(null);
      void balanceRead.refetch();
    } catch (e) {
      setError(friendlyError(e));
      setPhase("between"); setProgress(null);
      setLeg2(null); // never reuse a quote after a failed or ambiguous send
    }
  }

  function fill(pct: number) {
    if (!fromInfo || balance === undefined || busy) return;
    setAmount(fractionOfBalance(balance, fromInfo.decimals, pct, 18, 1));
  }
  function flip() {
    if (busy || phase !== "idle") return;
    setFrom(to); setTo(from);
  }

  const canStart = !!helper && !!leg1 && leg1.sim.ok && !expired1 && phase === "idle" && LIVE && !sameToken;
  const canStep2 = !!leg2 && leg2.sim.ok && !expired2 && phase === "between" && LIVE;
  const statusText = loading ? "Getting the best prices…"
    : sameToken ? "Pick two different stocks."
    : !amountValid ? "Enter an amount up to 1."
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
          <span className="convert-pick">
            <TokenLogo symbol={from} size={22} />
            <select value={from} disabled={busy || phase !== "idle"} onChange={(e) => setFrom(e.target.value)} aria-label="From token">
              {tokens.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </span>
        </div>
      </div>
      <button type="button" className="ticket-arrow flipbtn" onClick={flip} disabled={busy || phase !== "idle"} aria-label="Swap direction">↓↑</button>
      <div className="ticket-box">
        <span className="muted small">To (about)</span>
        <div className="ticket-line">
          <span className="ticket-out">{estimateOut ? fmt(estimateOut) : "0"}</span>
          <span className="convert-pick">
            <TokenLogo symbol={to} size={22} />
            <select value={to} disabled={busy || phase !== "idle"} onChange={(e) => setTo(e.target.value)} aria-label="To token">
              {tokens.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </span>
        </div>
      </div>
      <p className="muted small ticket-status" role="status">{statusText}</p>
      {error && <p className="err">{error}</p>}

      <ol className="convert-steps">
        <li className={phase === "idle" ? "now" : "done"}>
          <strong>Step 1 · Sell {from} for USDT</strong>
          <div className="muted small">
            {leg1 ? `You get about ${fmt(estimate ?? "0")} USDT · ${leg1.sim.ok ? "simulation passed" : `simulation failed: ${leg1.sim.error}`}${phase === "idle" ? ` · refreshes in ${left1}s` : ""}` : "Waiting for a quote."}
          </div>
          {hash1 && <div className="small"><a href={`https://bscscan.com/tx/${hash1}`} target="_blank" rel="noreferrer">View step 1 transaction</a>{received ? ` · received ${fmt(received)} USDT` : ""}</div>}
        </li>
        <li className={phase === "between" || phase === "sending2" ? "now" : phase === "done" ? "done" : ""}>
          <strong>Step 2 · Buy {to} with that USDT</strong>
          <div className="muted small">
            {phase === "idle" || phase === "sending1" ? (estimateOut ? `About ${fmt(estimateOut)} ${to}, quoted for real once step 1 lands.` : "Quoted for real once step 1 lands, using the USDT you actually received.")
              : leg2 ? `You get about ${fmt(leg2.quote.amountOut)} ${to} · ${leg2.sim.ok ? "simulation passed" : `simulation failed: ${leg2.sim.error}`}${phase === "between" ? ` · refreshes in ${left2}s` : ""}`
              : "Getting a quote…"}
          </div>
          {hash2 && <div className="small"><a href={`https://bscscan.com/tx/${hash2}`} target="_blank" rel="noreferrer">View step 2 transaction</a></div>}
        </li>
      </ol>

      {busy && <p className="muted small">{progress}</p>}
      {phase === "done" && <p className="pos small">Converted. Both steps are public on-chain and saved in Portfolio.</p>}
      {phase === "between" && received && !leg2 && !loading && (
        <button type="button" className="ghost" onClick={() => void quoteLeg2(String(Math.min(50, Number(received))))}>Refresh step 2</button>
      )}
      {expired2 && !loading && <button type="button" className="ghost" onClick={() => void quoteLeg2(leg2!.quote.request.amountIn)}>Quote expired. Refresh step 2</button>}

      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        {phase === "idle" || phase === "sending1" ? (
          <button disabled={!canStart} onClick={() => void runStep1()} style={{ flex: 1 }}>
            {!isConnected ? "Connect wallet to convert" : `Step 1: sell ${from}`}
          </button>
        ) : phase === "done" ? (
          <button className="ghost" onClick={resetAll} style={{ flex: 1 }}>Convert again</button>
        ) : (
          <button disabled={!canStep2} onClick={() => void runStep2()} style={{ flex: 1 }}>Step 2: buy {to}</button>
        )}
      </div>
      <p className="muted small" style={{ margin: "8px 0 0" }}>
        Two separate swaps through USDT, each simulated first, each needing your wallet. The second starts only after the first confirms, and uses the USDT you actually received. If step 2 fails, your USDT stays in your wallet. Capped at 1 {from} per convert while live swaps are being tested. Both trades are public on-chain.
      </p>
      {isConnected && !LIVE && <p className="warn small">Live swaps are off. Set NEXT_PUBLIC_LIVE_SWAPS=1.</p>}
    </div>
  );
}
