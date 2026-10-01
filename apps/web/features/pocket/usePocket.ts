"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createPocket as createStoredPocket,
  exportPocketKey as decryptPocketKey,
  fundPocket as sendUsdtToPocket,
  loadPocketJob,
  pocketBackupVerified,
  pocketRecordExists,
  readPocket,
  readPocketBalances,
  releasePocketJobSpend,
  reservePocketJobSpend,
  runAgentTick as runPocketAgentTick,
  setPocketJobStatus,
  unlockPocket,
  verifyPocketBackup,
  withdrawPocket as sendUsdtToMain,
  isPocketConfigReady,
  type AgentTickResult,
  type GuardedSwapExecutor,
  type Job,
  type MainSigner,
  type Pocket,
  type PocketBalances,
  type SessionTradeRecord,
} from "@stockx/shared/pocket";

export interface UsePocketOptions {
  mainAddress: string;
  getMainSigner: () => MainSigner | Promise<MainSigner>;
  executor?: GuardedSwapExecutor | null;
}

export type PocketStatus = "loading" | "ready" | "not_configured" | "corrupt" | "error";

export interface UsePocketResult {
  pocket: Pocket | null;
  exported: boolean;
  balances: PocketBalances;
  job: Job | null;
  activity: SessionTradeRecord[];
  status: PocketStatus;
  createPocket(password: string): Promise<Pocket | null>;
  exportKey(password: string): Promise<boolean>;
  verifyBackup(privateKey: string): boolean;
  fund(amountUsdt: number): Promise<string | null>;
  withdraw(password: string, amountUsdt: number): Promise<string | null>;
  startAgent(): Promise<boolean>;
  stopAgent(): Promise<void>;
  runOneTick(password: string, amountUsdt: number): Promise<AgentTickResult>;
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

export function usePocket({ mainAddress, getMainSigner, executor = null }: UsePocketOptions): UsePocketResult {
  const [stored, setStored] = useState<ReturnType<typeof readPocket>>(null);
  const [exported, setExported] = useState(false);
  const [balances, setBalances] = useState<PocketBalances>({ usdt: "0", bnb: "0" });
  const [job, setJob] = useState<Job | null>(null);
  const [activity, setActivity] = useState<SessionTradeRecord[]>([]);
  const [status, setStatus] = useState<PocketStatus>("loading");

  const refresh = useCallback(async (current: NonNullable<typeof stored>) => {
    const [nextBalances, nextJob] = await Promise.all([
      readPocketBalances(current.address),
      loadPocketJob(localStorage, browserJobLock(), current.address),
    ]);
    setBalances(nextBalances);
    setJob(nextJob);
  }, []);

  useEffect(() => {
    try {
      if (!pocketRecordExists(localStorage)) {
        setStatus(isPocketConfigReady ? "ready" : "not_configured");
        return;
      }
      const existing = readPocket(localStorage);
      if (!existing) throw new Error("Pocket record missing.");
      setStored(existing);
      setExported(pocketBackupVerified(localStorage, existing.address));
      setStatus(isPocketConfigReady ? "ready" : "not_configured");
      void refresh(existing).catch(() => setStatus("error"));
    } catch {
      setStatus("corrupt");
    }
  }, [refresh]);

  const create = useCallback(async (password: string) => {
    try {
      if (pocketRecordExists(localStorage)) throw new Error("A pocket record already exists.");
      const created = await createStoredPocket(password, localStorage, navigator.locks);
      setStored(created);
      setExported(false);
      await refresh(created);
      setStatus(isPocketConfigReady ? "ready" : "not_configured");
      return { address: created.address, exported: false };
    } catch {
      setStatus("error");
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

  const withdraw = useCallback(async (password: string, amountUsdt: number) => {
    if (!stored || !mainAddress || !Number.isFinite(amountUsdt) || amountUsdt <= 0) return null;
    const mainSigner = await getMainSigner();
    if ((await mainSigner.getAddress()).toLowerCase() !== mainAddress.toLowerCase()) {
      throw new Error("Main signer does not match connected wallet.");
    }
    const signer = await unlockPocket(stored, password);
    const hash = await sendUsdtToMain(signer, stored.address, mainAddress, amountUsdt);
    await refresh(stored);
    return hash;
  }, [getMainSigner, mainAddress, refresh, stored]);

  const runOneTick = useCallback(async (password: string, amountUsdt: number): Promise<AgentTickResult> => {
    if (!stored || !job || !mainAddress) return { status: "rejected", reason: "pocket_or_main_missing" };
    if (!executor) return { status: "rejected", reason: "not_configured" };
    try {
      const signer = await unlockPocket(stored, password);
      const result = await runPocketAgentTick({
        pocket: { address: stored.address, exported },
        job,
        helper: executor,
        mainAddress,
        signer,
        storage: localStorage,
        locks: browserJobLock(),
        balances: await readPocketBalances(stored.address),
        amountUsdt,
      });
      if ("job" in result && result.job) setJob(result.job);
      if (result.status === "executed") setActivity((records) => [result.record, ...records]);
      return result;
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : "agent_tick_failed" };
    }
  }, [executor, exported, job, mainAddress, stored]);

  const startAgent = useCallback(async () => {
    if (!executor || !stored || !exported || !mainAddress || !isPocketConfigReady) {
      setStatus("not_configured");
      return false;
    }
    setJob(await setPocketJobStatus(localStorage, browserJobLock(), stored.address, "active"));
    return true;
  }, [executor, exported, mainAddress, stored]);

  const stopAgent = useCallback(async () => {
    if (!stored) return;
    setJob(await setPocketJobStatus(localStorage, browserJobLock(), stored.address, "stopped"));
  }, [stored]);

  return {
    pocket: stored ? { address: stored.address, exported } : null,
    exported,
    balances,
    job,
    activity,
    status,
    createPocket: create,
    exportKey,
    verifyBackup,
    fund,
    withdraw,
    startAgent,
    stopAgent,
    runOneTick,
  };
}