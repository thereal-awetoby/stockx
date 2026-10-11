"use client";

import { useRef, useState } from "react";
import { createMockProvider, createSwapHelper, type SwapPipeline } from "@stockx/shared";
import { agentLimitsOff, maxWithdrawable, MIN_SESSION_BNB_GAS, isPipelineFactory, parseAgentInstruction, pocketCopy, railgunEnabled, type MainSigner, type ParseResult, type PocketAsset, type PocketPipelineSource } from "@stockx/shared/pocket";
import { formatBalance } from "../../lib/amount";
import { KeyBackupDialog } from "./KeyBackupDialog";
import { useAgentClock } from "./useAgentClock";
import { usePocket } from "./usePocket";

const mockPipeline = createSwapHelper(createMockProvider(), { actor: "agent" });

const SUGGESTIONS = ["Buy $2 of AAPLB now", "Buy $1 of AAPLB every day at 3pm UTC"];

/** The address IS the control: click it to copy. No separate button. */
function AddressChip({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="addr-chip"
      title="Click to copy"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(
          () => { setCopied(true); window.setTimeout(() => setCopied(false), 1_600); },
          () => setCopied(false),
        );
      }}
    >
      <span className="addr-label">{label}</span>
      <span className={`addr-value${copied ? " copied" : ""}`}>{copied ? "Copied to clipboard" : address}</span>
    </button>
  );
}

export interface PocketPanelProps {
  mainAddress: string;
  getMainSigner: () => MainSigner | Promise<MainSigner>;
  pipeline?: PocketPipelineSource | null;
  /** @deprecated Pass pipeline instead. */
  executor?: SwapPipeline | null;
}

export function PocketPanel({ mainAddress, getMainSigner, pipeline, executor }: PocketPanelProps) {
  const activePipeline = pipeline ?? executor ?? mockPipeline;
  const pocket = usePocket({ mainAddress, getMainSigner, pipeline: activePipeline });
  const [password, setPassword] = useState("");
  const backupKey = useRef<HTMLInputElement>(null);
  const [fundAmount, setFundAmount] = useState("5");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [wAsset, setWAsset] = useState<PocketAsset>("USDT");
  const [withdrawn, setWithdrawn] = useState<{ hash: string; amount: string; asset: PocketAsset } | null>(null);
  const [buyAmount, setBuyAmount] = useState("5");
  const [message, setMessage] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState("");
  const [xfer, setXfer] = useState<"fund" | "withdraw">("fund");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<ParseResult | null>(null);
  const [schedule, setSchedule] = useState({ hourUtc: 15, minuteUtc: 0 });

  useAgentClock(pocket.job?.status === "active" && pocket.armed, () => {
    void pocket.runOneTick(password, buyAmount).then((result) => {
      const errorCode = "errorCode" in result ? result.errorCode : undefined;
      setMessage(errorCode ? `${result.status}: ${errorCode}` : result.status);
    });
  }, schedule.hourUtc, schedule.minuteUtc);

  /** Step 1: read the sentence. Nothing runs yet. */
  function understand(): void {
    setProposal(parseAgentInstruction(instruction));
    setMessage("");
  }

  /** Step 2: only after the user confirms the plain-English summary. */
  async function confirmProposal(): Promise<void> {
    if (!proposal || !proposal.ok) return;
    const { intent } = proposal;
    if (!pocket.exported) {
      setMessage("Back up the pocket key first.");
      return;
    }
    if (intent.when === "now" && !password) {
      setMessage("Enter your pocket passphrase below, then confirm again.");
      return;
    }
    setBuyAmount(intent.amountUsdt);
    if (intent.when === "daily") setSchedule({ hourUtc: intent.hourUtc, minuteUtc: intent.minuteUtc });
    const armed = await pocket.startAgent();
    if (!armed) {
      setMessage("Couldn't arm the agent. Check the pocket and the swap pipeline.");
      return;
    }
    setProposal(null);
    setInstruction("");
    if (intent.when === "daily") {
      setMessage("Agent armed. It will buy on schedule while this tab stays open. Press Stop agent to cancel.");
      return;
    }
    const result = await pocket.runOneTick(password, intent.amountUsdt);
    setPassword("");
    const errorCode = "errorCode" in result ? result.errorCode : undefined;
    setMessage(errorCode ? `${result.status}: ${errorCode}` : result.status);
  }

  async function create(): Promise<void> {
    const created = await pocket.createPocket(password);
    if (created) setPassword(""); // keep what was typed if creation failed, so the error is easy to fix
    setMessage(created ? "Pocket ready." : "");
  }

  async function exportKey(): Promise<void> {
    const key = await pocket.revealKey(password);
    setPassword("");
    setKeyError(key ? "" : "Could not unlock the pocket key. Check your passphrase.");
    setRevealedKey(key);
  }

  async function fund(): Promise<void> {
    try {
      const hash = await pocket.fund(Number(fundAmount));
      setMessage(hash ? `Funding transaction: ${hash}` : "Funding is unavailable.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Funding failed.");
    }
  }

  const assetBalance = (asset: PocketAsset): string => (asset === "USDT" ? pocket.balances.usdt : asset === "BNB" ? pocket.balances.bnb : pocket.aaplbBalance);

  async function withdraw(): Promise<void> {
    const amount = withdrawAmount.trim();
    setWithdrawn(null);
    setMessage("");
    if (!/^\d+(\.\d+)?$/.test(amount) || !(Number(amount) > 0)) { setMessage("Enter an amount to withdraw."); return; }
    if (Number(amount) > Number(assetBalance(wAsset))) { setMessage(`The pocket only holds ${formatBalance(assetBalance(wAsset), 6)} ${wAsset}.`); return; }
    setMessage(`Sending ${amount} ${wAsset} to your main wallet. Waiting for it to confirm…`);
    try {
      const hash = await pocket.withdraw(password, wAsset, amount);
      if (hash) { setWithdrawn({ hash, amount, asset: wAsset }); setMessage(""); setWithdrawAmount(""); }
      else setMessage("Withdrawal is unavailable.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Withdrawal failed.");
    } finally {
      setPassword("");
    }
  }

  async function runOneTick(): Promise<void> {
    const result = await pocket.runOneTick(password, buyAmount);
    setPassword("");
    const errorCode = "errorCode" in result ? result.errorCode : undefined;
    setMessage(errorCode ? `${result.status}: ${errorCode}` : result.status);
  }

  const armed = pocket.armed && pocket.job?.status === "active";
  const hh = String(schedule.hourUtc).padStart(2, "0");
  const mm = String(schedule.minuteUtc).padStart(2, "0");
  const lowGas = Number(pocket.balances.bnb) < MIN_SESSION_BNB_GAS;
  const pipelineLine = pipeline && isPipelineFactory(pipeline)
    ? (agentLimitsOff() ? "Live · real funds · buy-only · limits off" : "Live · real funds · buy-only · max $5 per trade")
    : pipeline || executor ? "Swap pipeline connected" : "Mock pipeline";
  const feed = [
    ...pocket.activity.map((t, i) => ({ k: `a-${t.txHash}-${i}`, time: t.timestamp, text: `${t.side === "buy" ? "Bought" : "Sold"} ${t.amountUsdt} USDT of ${t.token}`, hash: t.txHash, bad: false })),
    ...pocket.runLog.map((e, i) => ({ k: `r-${e.timestamp}-${i}`, time: e.timestamp, text: `${e.message}${e.errorCode ? ` · ${e.errorCode}` : ""}`, hash: "", bad: Boolean(e.errorCode) })),
  ].sort((x, y) => y.time - x.time);

  return (
    <section className="agent">
      <div className="agent-grid">
        {/* left: the pocket */}
        <div className="agent-col">
          <div className="panel">
            <div className="panel-head">
              <h2>Session pocket</h2>
              <span className="status-pill">{pocket.status}</span>
            </div>
            <AddressChip label="Main wallet" address={mainAddress || "Not connected"} />
            {pocket.pocket && (
              <>
                <AddressChip label="Pocket address" address={pocket.pocket.address} />
                <p className="muted small hint">Click an address to copy it. Send BNB to the pocket on BNB Smart Chain only, for gas.</p>
              </>
            )}
            <div className="tiles">
              <div className="tile"><span>USDT</span><strong>{pocket.balanceError ? "n/a" : formatBalance(pocket.balances.usdt, 4)}</strong></div>
              <div className="tile"><span>BNB</span><strong>{pocket.balanceError ? "n/a" : formatBalance(pocket.balances.bnb, 5)}</strong></div>
              <div className="tile"><span>AAPLB</span><strong>{pocket.aaplbBalanceError ? "n/a" : formatBalance(pocket.aaplbBalance, 6)}</strong></div>
            </div>
            {(pocket.balanceError || pocket.aaplbBalanceError) && <p className="err">Some balances are unavailable right now.</p>}
            {lowGas && <p className="warn small" style={{ marginTop: 8 }}>{pocketCopy.smallBalance}</p>}
          </div>

          {!pocket.pocket && pocket.status !== "corrupt" && pocket.status !== "loading" && pocket.status !== "error" && (
            <div className="panel">
              <h2>Create pocket</h2>
              <label htmlFor="pocket-create-password">Encryption passphrase (at least 10 characters)</label>
              <input id="pocket-create-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <button type="button" onClick={() => void create()}>Create pocket</button>
              {pocket.operationError && <p className="err">{pocket.operationError}</p>}
            </div>
          )}

          {pocket.pocket && !pocket.exported && (
            <div className="panel">
              <h2>Back up your key first</h2>
              <p className="muted small">Anyone with this key can move the pocket's funds. Keep it offline.</p>
              <label htmlFor="pocket-password">Passphrase</label>
              <input id="pocket-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <button type="button" onClick={() => void exportKey()}>Show key</button>
              {keyError && <p className="err">{keyError}</p>}
              <label htmlFor="pocket-backup-key">Paste key to verify backup</label>
              <input id="pocket-backup-key" type="password" ref={backupKey} />
              <button type="button" className="ghost" onClick={() => {
                const pastedKey = backupKey.current?.value ?? "";
                if (backupKey.current) backupKey.current.value = "";
                const verified = pocket.verifyBackup(pastedKey);
                setMessage(verified ? "Backup verified." : "Key does not match this pocket.");
              }}>Verify backup</button>
            </div>
          )}

          {pocket.pocket && pocket.exported && (
            <div className="panel">
              <div className="seg" role="tablist" aria-label="Move USDT">
                <button type="button" role="tab" aria-selected={xfer === "fund"} className={xfer === "fund" ? "on" : ""} onClick={() => setXfer("fund")}>Fund pocket</button>
                <button type="button" role="tab" aria-selected={xfer === "withdraw"} className={xfer === "withdraw" ? "on" : ""} onClick={() => setXfer("withdraw")}>Withdraw</button>
              </div>
              {xfer === "fund" ? (
                <>
                  <label htmlFor="pocket-fund-amount">USDT to send from your main wallet</label>
                  <input id="pocket-fund-amount" inputMode="decimal" value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} />
                  <button type="button" disabled={!pocket.exported || !mainAddress} onClick={() => void fund()}>Fund pocket</button>
                </>
              ) : (
                <>
                  <div className="asset-pick" role="group" aria-label="Asset to withdraw">
                    {(["USDT", "BNB", "AAPLB"] as PocketAsset[]).map((a) => (
                      <button key={a} type="button" className={wAsset === a ? "on" : ""} onClick={() => { setWAsset(a); setWithdrawAmount(""); setWithdrawn(null); }}>{a}</button>
                    ))}
                  </div>
                  <label htmlFor="pocket-withdraw-amount">
                    Amount to send to your main wallet · available {formatBalance(assetBalance(wAsset), wAsset === "BNB" ? 5 : 6)} {wAsset}
                  </label>
                  <div className="amount-row">
                    <input id="pocket-withdraw-amount" inputMode="decimal" value={withdrawAmount} placeholder="0" onChange={(event) => setWithdrawAmount(event.target.value)} />
                    <button type="button" className="ghost" onClick={() => setWithdrawAmount(maxWithdrawable(wAsset, assetBalance(wAsset)))}>Max</button>
                  </div>
                  {wAsset === "BNB" && <p className="muted small hint">Max keeps a tiny amount of BNB back to pay for this transfer.</p>}
                  <label htmlFor="pocket-withdraw-password">Pocket passphrase</label>
                  <input id="pocket-withdraw-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                  <button type="button" disabled={!mainAddress || !password} onClick={() => void withdraw()}>Withdraw to connected wallet</button>
                  {withdrawn && (
                    <div className="sent-card" role="status">
                      <strong>Sent {formatBalance(withdrawn.amount, 8)} {withdrawn.asset} to your main wallet.</strong>
                      <a href={`https://bscscan.com/tx/${withdrawn.hash}`} target="_blank" rel="noreferrer">View on BscScan</a>
                      <span className="muted small">Your wallet app may not list it under Activity because the pocket sent it. Check your balance or BscScan.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* right: the agent console */}
        <div className="agent-col">
          <div className="console">
            <div className="panel-head">
              <h2>Agent</h2>
              <span className={`status-pill ${armed ? "live" : ""}`}><i />{armed ? "Armed" : "Idle"}</span>
            </div>
            <p className="console-meta">{pipelineLine}</p>
            <p className="console-meta">
              Spent {pocket.job?.spentUsdt ?? 0}{agentLimitsOff() ? " USDT · no cap" : ` of ${pocket.job?.capUsdt ?? 25} USDT`}
              {armed && <> · runs daily at {hh}:{mm} UTC while this tab is open</>}
            </p>

            <label htmlFor="pocket-agent-instruction" className="console-label">Tell the agent what to do</label>
            <div className="prompt">
              <input
                id="pocket-agent-instruction"
                value={instruction}
                maxLength={300}
                placeholder="e.g. buy $2 of AAPLB now"
                autoComplete="off"
                onChange={(event) => { setInstruction(event.target.value); setProposal(null); }}
                onKeyDown={(event) => { if (event.key === "Enter") understand(); }}
              />
              <button type="button" disabled={!instruction.trim()} onClick={understand}>Understand</button>
            </div>
            <div className="chips">
              {SUGGESTIONS.map((text) => (
                <button key={text} type="button" className="chip-btn" onClick={() => { setInstruction(text); setProposal(parseAgentInstruction(text)); setMessage(""); }}>{text}</button>
              ))}
            </div>

            {proposal && !proposal.ok && <p className="console-err">{proposal.reason}</p>}
            {proposal && proposal.ok && (
              <div className="proposal" role="group" aria-label="Agent instruction to confirm">
                <strong>{proposal.summary}</strong>
                {proposal.notes.map((note) => <span key={note} className="console-meta">{note}</span>)}
                <span className="console-meta">Real funds · session pocket only · buy-only. Nothing happens until you confirm.</span>
                <div className="proposal-actions">
                  <button type="button" onClick={() => void confirmProposal()}>Confirm</button>
                  <button type="button" className="ghost-dark" onClick={() => setProposal(null)}>Cancel</button>
                </div>
              </div>
            )}

            <label htmlFor="pocket-agent-password" className="console-label">Pocket passphrase</label>
            <input id="pocket-agent-password" className="console-input" type="password" value={password} placeholder="needed to run a trade" onChange={(event) => setPassword(event.target.value)} />

            <details className="manual">
              <summary>Manual controls</summary>
              <label htmlFor="pocket-agent-amount" className="console-label">Buy amount in USDT</label>
              <input id="pocket-agent-amount" className="console-input" inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} />
              <div className="proposal-actions">
                <button type="button" aria-pressed={pocket.armed} disabled={!pocket.exported} onClick={() => void pocket.startAgent()}>Arm agent</button>
                <button type="button" className="ghost-dark" disabled={!pocket.job || pocket.job.status !== "active"} onClick={() => void pocket.stopAgent()}>Stop agent</button>
                <button type="button" className="ghost-dark" disabled={!pocket.exported || !pocket.armed} onClick={() => void runOneTick()}>Run one tick</button>
              </div>
            </details>
            {armed && (
              <div className="proposal-actions">
                <button type="button" className="ghost-dark" onClick={() => void pocket.stopAgent()}>Stop agent</button>
              </div>
            )}
            {(message || pocket.operationError) && <p role="status" className="console-status">{message || pocket.operationError}</p>}
          </div>

          <div className="panel">
            <h2>Activity</h2>
            {feed.length === 0 ? (
              <p className="muted small">Nothing yet. Trades and agent events show up here live.</p>
            ) : (
              <ul className="feed">
                {feed.map((f) => (
                  <li key={f.k} className={f.bad ? "bad" : ""}>
                    <span className="feed-time">{new Date(f.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="feed-text">{f.text}</span>
                    {f.hash && <a href={`https://bscscan.com/tx/${f.hash}`} target="_blank" rel="noreferrer">View</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="agent-notes muted small">
        <p>{pocketCopy.fundedPocket}</p>
        {railgunEnabled && <p>{pocketCopy.railgunUsdt}</p>}
        <p>{pocketCopy.publicStockLeg}</p>
        <p>{pocketCopy.keyRisk}</p>
      </div>
      {revealedKey && pocket.pocket && (
        <KeyBackupDialog privateKey={revealedKey} address={pocket.pocket.address} onClose={() => setRevealedKey(null)} />
      )}
    </section>
  );
}
