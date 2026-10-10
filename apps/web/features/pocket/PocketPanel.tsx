"use client";

import { useRef, useState } from "react";
import { createMockProvider, createSwapHelper, type SwapPipeline } from "@stockx/shared";
import { MIN_SESSION_BNB_GAS, isPipelineFactory, pocketCopy, railgunEnabled, type MainSigner, type PocketPipelineSource } from "@stockx/shared/pocket";
import { useAgentClock } from "./useAgentClock";
import { usePocket } from "./usePocket";

const mockPipeline = createSwapHelper(createMockProvider(), { actor: "agent" });

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
  const [withdrawAmount, setWithdrawAmount] = useState("5");
  const [buyAmount, setBuyAmount] = useState("5");
  const [message, setMessage] = useState("");

  useAgentClock(pocket.job?.status === "active" && pocket.armed, () => {
    void pocket.runOneTick(password, buyAmount).then((result) => {
      const errorCode = "errorCode" in result ? result.errorCode : undefined;
      setMessage(errorCode ? `${result.status}: ${errorCode}` : result.status);
    });
  });

  async function create(): Promise<void> {
    const created = await pocket.createPocket(password);
    if (created) setPassword(""); // keep what was typed if creation failed, so the error is easy to fix
    setMessage(created ? "Pocket ready." : "");
  }

  async function exportKey(): Promise<void> {
    const succeeded = await pocket.exportKey(password);
    setPassword("");
    setMessage(succeeded ? "Export started. Paste the saved key below to verify it." : "Could not export the pocket key.");
  }

  async function fund(): Promise<void> {
    try {
      const hash = await pocket.fund(Number(fundAmount));
      setMessage(hash ? `Funding transaction: ${hash}` : "Funding is unavailable.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Funding failed.");
    }
  }

  async function withdraw(): Promise<void> {
    try {
      const hash = await pocket.withdraw(password, Number(withdrawAmount));
      setMessage(hash ? `Withdrawal transaction: ${hash}` : "Withdrawal is unavailable.");
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

  return (
    <section className="pocket-panel">
      <h2>Session pocket</h2>
      <p>Main wallet: {mainAddress || "Not connected"}</p>
      <p>{pocket.status}</p>
      <p className="pocket-balance">
        USDT: {pocket.balanceError ? `unavailable (${pocket.balanceError})` : pocket.balances.usdt}
      </p>
      <p className="pocket-balance">
        BNB: {pocket.balanceError ? `unavailable (${pocket.balanceError})` : pocket.balances.bnb}
      </p>
      <p className="pocket-balance">
        AAPLB: {pocket.aaplbBalanceError ? `unavailable (${pocket.aaplbBalanceError})` : pocket.aaplbBalance}
      </p>
      {Number(pocket.balances.bnb) < MIN_SESSION_BNB_GAS && <p>{pocketCopy.smallBalance}</p>}

      {!pocket.pocket && pocket.status !== "corrupt" && pocket.status !== "loading" && pocket.status !== "error" && (
        <section>
          <h2>Create pocket</h2>
          <label htmlFor="pocket-create-password">Encryption passphrase (at least 10 characters)</label>
          <input id="pocket-create-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" onClick={() => void create()}>Create</button>
          {pocket.operationError && <p className="err">{pocket.operationError}</p>}
        </section>
      )}

      {pocket.pocket && !pocket.exported && (
        <section>
          <h2>Back up pocket key</h2>
          <label htmlFor="pocket-password">Passphrase</label>
          <input id="pocket-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" onClick={() => void exportKey()}>Export key</button>
          <label htmlFor="pocket-backup-key">Paste key to verify backup</label>
          <input id="pocket-backup-key" type="password" ref={backupKey} />
          <button type="button" onClick={() => {
            const pastedKey = backupKey.current?.value ?? "";
            if (backupKey.current) backupKey.current.value = "";
            const verified = pocket.verifyBackup(pastedKey);
            setMessage(verified ? "Backup verified." : "Key does not match this pocket.");
          }}>Verify backup</button>
        </section>
      )}

      {pocket.pocket && pocket.exported && (
        <section className="pocket-fund">
          <h2>USDT transfers</h2>
          <label htmlFor="pocket-fund-amount">Fund amount</label>
          <input id="pocket-fund-amount" inputMode="decimal" value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} />
          <button type="button" disabled={!pocket.exported || !mainAddress} onClick={() => void fund()}>Fund</button>
          <label htmlFor="pocket-withdraw-amount">Withdraw amount</label>
          <input id="pocket-withdraw-amount" inputMode="decimal" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} />
          <label htmlFor="pocket-withdraw-password">Pocket passphrase</label>
          <input id="pocket-withdraw-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" disabled={!mainAddress} onClick={() => void withdraw()}>Withdraw to connected wallet</button>
        </section>
      )}

      <section className="pocket-agent">
        <h2>Agent</h2>
        <p>Job spend: {pocket.job?.spentUsdt ?? 0} / {pocket.job?.capUsdt ?? 25} USDT</p>
        <p>Take profit: not active in this build</p>
        <p>
          {pipeline && isPipelineFactory(pipeline)
            ? "Live session pipeline. Real funds. Buy-only, max $5 per trade."
            : pipeline || executor ? "Swap pipeline connected" : "Mock swap pipeline"}
        </p>
        <label htmlFor="pocket-agent-amount">Buy amount in USDT</label>
        <input id="pocket-agent-amount" inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} />
        <label htmlFor="pocket-agent-password">Pocket passphrase</label>
        <input id="pocket-agent-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <button type="button" aria-pressed={pocket.armed} disabled={!pocket.exported} onClick={() => void pocket.startAgent()}>Arm agent</button>
        <button type="button" disabled={!pocket.job || pocket.job.status !== "active"} onClick={() => void pocket.stopAgent()}>Stop agent</button>
        <button type="button" disabled={!pocket.exported || !pocket.armed} onClick={() => void runOneTick()}>Run one tick</button>
      </section>

      <section>
        <h2>Session activity</h2>
        <ul>{pocket.activity.map((trade, index) => <li key={`${trade.txHash}-${index}`}>{trade.side} {trade.amountUsdt} USDT · {trade.txHash}</li>)}</ul>
      </section>

      <section>
        <h2>Agent run log</h2>
        <ul>{pocket.runLog.map((entry, index) => <li key={`${entry.timestamp}-${index}`}>
          {new Date(entry.timestamp).toLocaleTimeString()} {entry.message}{entry.errorCode ? ` · ${entry.errorCode}` : ""}
        </li>)}</ul>
      </section>

      <section>
        <p>{pocketCopy.fundedPocket}</p>
        {railgunEnabled && <p>{pocketCopy.railgunUsdt}</p>}
        <p>{pocketCopy.publicStockLeg}</p>
        <p>{pocketCopy.keyRisk}</p>
      </section>
      <p role="status">{message || pocket.operationError}</p>
    </section>
  );
}