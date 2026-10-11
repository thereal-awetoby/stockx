"use client";

import { recordTrade } from "../../lib/trade-log";
import { useCallback, useEffect, useRef, useState } from "react";
import { SwapError, TOKENS, getRwaMarket } from "@stockx/shared";
import {
  createPocket as createStoredPocket,
  exportPocketKey as decryptPocketKey,
  fundPocket as sendUsdtToPocket,
  loadPocketJob,
  pocketBackupVerified,
  pocketRecordExists,
  readPocket,
  readPocketAaplbBalance,
  readPocketBalances,
  createTickGate,
  releasePocketJobSpend,
  reservePocketJobSpend,
  resolvePocketPipeline,
  runAgentTick as runPocketAgentTick,
  setPocketJobStatus,
  unlockPocket,
  verifyPocketBackup,
  withdrawPocketAsset as sendAssetToMain,
  type PocketAsset,
  type AgentTickResult,
  type AgentRunLogEntry,
  type Job,
  type MainSigner,
  type Pocket,
  type PocketBalances,
  type PocketPipelineSource,
  type SessionTradeRecord,
} from "@stockx/shared/pocket";

export interface UsePocketOptions {
  mainAddress: string;
  getMainSigner: () => MainSigner | Promise<MainSigner>;
  pipeline?: PocketPipelineSource | null;
}

export type PocketStatus = "loading" | "ready" | "not_configured" | "corrupt" | "error";

export interface UsePocketResult {
  pocket: Pocket | null;
  exported: boolean;
  balances: PocketBalances;
  balanceError: string | null;
  aaplbBalance: string;
  aaplbBalanceError: string | null;
  operationError: string | null;
  job: Job | null;
  activity: SessionTradeRecord[];
  runLog: AgentRunLogEntry[];
  armed: boolean;
  status: PocketStatus;
  createPocket(password: string): Promise<Pocket | null>;
  exportKey(password: string): Promise<boolean>;
  /** Decrypts the session key and returns it (for the backup dialog). null if the passphrase is wrong. */
  revealKey(password: string): Promise<string | null>;
  verifyBackup(privateKey: string): boolean;
  fund(amountUsdt: number): Promise<string | null>;
  withdraw(password: string, asset: PocketAsset, amount: string): Promise<string | null>;
  startAgent(): Promise<boolean>;
  stopAgent(): Promise<void>;
  runOneTick(password: string, amountUsdt: string): Promise<AgentTickResult>;
}

function browserJobLock() {
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error("Browser Web Locks are required for pocket state.");
  return {
    request: <T,>(name: string, task: () => Promise<T>): Promise<T> =>
      navigator.locks.request<Promise<T>>(name, { mode: "exclusive" }, task).then((result) => result),
  };
}

function downloadPrivateKey(privateKey: string): void {
  const blob = new Blob([`${privateKey}\n`], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "stockx-session-private-key.txt";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function toRunLogEntry(result: AgentTickResult): AgentRunLogEntry {
  const errorCode = "errorCode" in result ? result.errorCode : undefined;
  const message = "reason" in result ? `${result.status}: ${result.reason}` : result.status;
  return {
    timestamp: Date.now(),
    status: result.status,
    message,
    ...(errorCode ? { errorCode } : {}),
  };
}

export function usePocket({ mainAddress, getMainSigner, pipeline = null }: UsePocketOptions): UsePocketResult {
  const [stored, setStored] = useState<ReturnType<typeof readPocket>>(null);
  const [exported, setExported] = useState(false);
  const [balances, setBalances] = useState<PocketBalances>({ usdt: "0", bnb: "0" });
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [aaplbBalance, setAaplbBalance] = useState("0");
  const [aaplbBalanceError, setAaplbBalanceError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [activity, setActivity] = useState<SessionTradeRecord[]>([]);
  const [runLog, setRunLog] = useState<AgentRunLogEntry[]>([]);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const tickGate = useRef(createTickGate());
  const [status, setStatus] = useState<PocketStatus>("loading");

  const refresh = useCallback(async (current: NonNullable<typeof stored>) => {
    const nextJob = await loadPocketJob(localStorage, browserJobLock(), current.address);
    setJob(nextJob);
    const [nextBalances, nextAaplbBalance] = await Promise.allSettled([
      readPocketBalances(current.address),
      readPocketAaplbBalance(current.address),
    ]);
    if (nextBalances.status === "fulfilled") {
      setBalances(nextBalances.value);
      setBalanceError(null);
    } else {
      setBalanceError(nextBalances.reason instanceof Error ? nextBalances.reason.message : "Unable to read USDT and BNB balances.");
    }
    if (nextAaplbBalance.status === "fulfilled") {
      setAaplbBalance(nextAaplbBalance.value);
      setAaplbBalanceError(null);
    } else {
      setAaplbBalanceError(nextAaplbBalance.reason instanceof Error ? nextAaplbBalance.reason.message : "Unable to read AAPLB balance.");
    }
  }, []);

  useEffect(() => {
    try {
      if (!pocketRecordExists(localStorage)) {
        setStatus("ready");
        return;
      }
      const existing = readPocket(localStorage);
      if (!existing) throw new Error("Pocket record missing.");
      setStored(existing);
      setExported(pocketBackupVerified(localStorage, existing.address));
      setStatus("ready");
      void refresh(existing).catch((error) => {
        setStatus("error");
        setOperationError(error instanceof Error ? error.message : "Unable to load pocket state.");
      });
    } catch {
      setStatus("corrupt");
    }
  }, [refresh]);

  const create = useCallback(async (password: string) => {
    setOperationError(null);
    try {
      const existing = readPocket(localStorage);
      if (existing) {
        setStored(existing);
        setExported(pocketBackupVerified(localStorage, existing.address));
        setStatus("ready");
        setOperationError("A pocket already exists in this browser and was loaded instead of replaced.");
        void refresh(existing).catch((error) => {
          setOperationError(error instanceof Error ? error.message : "Unable to load pocket state.");
        });
        return { address: existing.address, exported: pocketBackupVerified(localStorage, existing.address) };
      }
      const created = await createStoredPocket(password, localStorage, navigator.locks);
      setStored(created);
      setExported(false);
      setStatus("ready");
      void refresh(created).catch((error) => {
        setOperationError(error instanceof Error ? error.message : "Unable to load pocket state.");
      });
      return { address: created.address, exported: false };
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Unable to create the session pocket.");
      try {
        setStatus(pocketRecordExists(localStorage) ? "corrupt" : "ready");
      } catch {
        setStatus("error");
      }
      return null;
    }
  }, [refresh]);

  const exportKey = useCallback(async (password: string) => {
    if (!stored) return false;
    try {
      downloadPrivateKey(await decryptPocketKey(stored, password));
      return true;
    } catch {
      return false;
    }
  }, [stored]);

  const revealKey = useCallback(async (password: string): Promise<string | null> => {
    if (!stored) return null;
    try {
      return await decryptPocketKey(stored, password);
    } catch {
      return null;
    }
  }, [stored]);

  const verifyBackup = useCallback((privateKey: string) => {
    if (!stored || !verifyPocketBackup(stored.address, privateKey, localStorage)) return false;
    setExported(true);
    return true;
  }, [stored]);

  const fund = useCallback(async (amountUsdt: number) => {
    if (!stored || !exported || !mainAddress || !Number.isFinite(amountUsdt) || amountUsdt <= 0) return null;
    const signer = await getMainSigner();
    if ((await signer.getAddress()).toLowerCase() !== mainAddress.toLowerCase()) throw new Error("Main signer does not match connected wallet.");
    const hash = await sendUsdtToPocket(signer, stored.address, amountUsdt, localStorage);
    await refresh(stored);
    return hash;
  }, [exported, getMainSigner, mainAddress, refresh, stored]);

  const withdraw = useCallback(async (password: string, asset: PocketAsset, amount: string) => {
    if (!stored || !mainAddress) return null;
    const mainSigner = await getMainSigner();
    if ((await mainSigner.getAddress()).toLowerCase() !== mainAddress.toLowerCase()) {
      throw new Error("Main signer does not match connected wallet.");
    }
    const signer = await unlockPocket(stored, password);
    const hash = await sendAssetToMain(signer, stored.address, mainAddress, asset, amount);
    await refresh(stored);
    window.setTimeout(() => void refresh(stored).catch(() => undefined), 5_000); // public RPC nodes can lag a block
    return hash;
  }, [getMainSigner, mainAddress, refresh, stored]);

  const runOneTick = useCallback(async (password: string, amountUsdt: string): Promise<AgentTickResult> => {
    let result: AgentTickResult;
    const gate = tickGate.current.begin();
    if (!gate.ok) {
      // Never overlap ticks, and never tick again after an unconfirmed result (double-buy risk).
      const denied: AgentTickResult = { status: "rejected", reason: gate.reason };
      setRunLog((entries) => [toRunLogEntry(denied), ...entries].slice(0, 50));
      return denied;
    }
    if (!armedRef.current) {
      result = { status: "rejected", reason: "kill_switch_active" };
    } else if (!stored || !job || !mainAddress) {
      result = { status: "rejected", reason: "pocket_or_main_missing" };
    } else if (!pipeline) {
      result = { status: "rejected", reason: "not_configured" };
    } else {
    try {
      const signer = await unlockPocket(stored, password);
      result = await runPocketAgentTick({
        pocket: { address: stored.address, exported },
        job,
        helper: resolvePocketPipeline(pipeline, signer),
        mainAddress,
        signer,
        storage: localStorage,
        locks: browserJobLock(),
        balances: await readPocketBalances(stored.address),
        amountUsdt,
        isMarketOpen: async () => (await getRwaMarket(TOKENS.AAPLB.address)).open,
        canExecute: () => armedRef.current,
      });
    } catch (error) {
      result = {
        status: "failed",
        reason: error instanceof Error ? error.message : "agent_tick_failed",
        ...(error instanceof SwapError ? { errorCode: error.code } : {}),
      };
    }
    }
    tickGate.current.end(result.status);
    if ("job" in result && result.job) setJob(result.job);
    if (result.status === "executed") {
      setActivity((records) => [result.record, ...records]);
      if (stored) {
        recordTrade(stored.address, {
          t: result.record.timestamp, side: result.record.side, token: result.record.token,
          amountIn: String(result.record.amountUsdt), inSym: "USDT", amountOut: "", outSym: result.record.token,
          txHash: result.record.txHash, via: "agent",
        });
      }
    }
    const entry = toRunLogEntry(result);
    setRunLog((entries) => [entry, ...entries].slice(0, 50));
    // Balances change on-chain during a tick. Refresh now, and once more shortly after because
    // public BSC RPC nodes can lag a block behind.
    if (stored && result.status !== "rejected") {
      void refresh(stored).catch(() => undefined);
      window.setTimeout(() => void refresh(stored).catch(() => undefined), 5_000);
    }
    return result;
  }, [exported, job, mainAddress, pipeline, refresh, stored]);

  const startAgent = useCallback(async () => {
    if (!pipeline || !stored || !exported || !mainAddress || mainAddress.toLowerCase() === stored.address.toLowerCase()) {
      setStatus("not_configured");
      return false;
    }
    const activeJob = await setPocketJobStatus(localStorage, browserJobLock(), stored.address, "active");
    tickGate.current.acknowledgeUnconfirmed(); // re-arming is the owner confirming they checked the explorer
    armedRef.current = true;
    setArmed(true);
    setJob(activeJob);
    return true;
  }, [exported, mainAddress, pipeline, stored]);

  const stopAgent = useCallback(async () => {
    armedRef.current = false;
    setArmed(false);
    if (!stored) return;
    setJob(await setPocketJobStatus(localStorage, browserJobLock(), stored.address, "stopped"));
  }, [stored]);

  return {
    pocket: stored ? { address: stored.address, exported } : null,
    exported,
    balances,
    balanceError,
    aaplbBalance,
    aaplbBalanceError,
    operationError,
    job,
    activity,
    runLog,
    armed,
    status,
    createPocket: create,
    exportKey,
    revealKey,
    verifyBackup,
    fund,
    withdraw,
    startAgent,
    stopAgent,
    runOneTick,
  };
}