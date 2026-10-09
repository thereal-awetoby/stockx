import {
  commitPocketJobSpend,
  releasePocketJobSpend,
  reservePocketJobSpend,
  type PocketJobLock,
  type PocketJobStorage,
} from "./job-store";
import { POCKET_CONFIG, type PocketConfig } from "./config";
import { executeGuardedTrade } from "./guards";
import type { SwapPipeline } from "../types";
import type {
  AgentTickResult,
  Job,
  Pocket,
  PocketBalances,
  SessionSigner,
  SessionTradeRecord,
  TradeSide,
} from "./types";

export interface RunAgentTickInput {
  pocket: Pocket;
  job: Job;
  helper: SwapPipeline | null;
  mainAddress: string;
  signer: SessionSigner;
  storage: PocketJobStorage;
  locks: PocketJobLock;
  balances: PocketBalances;
  amountUsdt: string;
  isMarketOpen?: () => boolean | Promise<boolean>;
  canExecute?: () => boolean | Promise<boolean>;
  config?: PocketConfig;
}

export async function runAgentTick(input: RunAgentTickInput): Promise<AgentTickResult> {
  const { pocket, job, helper, mainAddress, signer, storage, locks, balances } = input;
  const config = input.config ?? POCKET_CONFIG;
  if (!helper) return { status: "rejected", reason: "not_configured" };
  if (!pocket.exported) return { status: "rejected", reason: "backup_not_verified" };
  if (job.status !== "active") return { status: "skipped", reason: "agent_stopped", job };
  if (mainAddress.toLowerCase() === pocket.address.toLowerCase()) {
    return { status: "rejected", reason: "session_must_differ_from_main" };
  }
  if ((await signer.getAddress()).toLowerCase() !== pocket.address.toLowerCase()) {
    return { status: "rejected", reason: "signer_must_be_session" };
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.amountUsdt) || !Number.isFinite(Number(input.amountUsdt)) || Number(input.amountUsdt) <= 0) {
    return { status: "rejected", reason: "invalid_trade_amount" };
  }
  const amountUsdt = Number(input.amountUsdt);
  if (amountUsdt > 5) return { status: "rejected", reason: "max_trade_exceeded" };

  const side: TradeSide = "buy";
  const utcDay = new Date().toISOString().slice(0, 10);
  let reservation: Extract<Awaited<ReturnType<typeof reservePocketJobSpend>>, { status: "reserved" }> | null = null;
  let executionMayHaveStarted = false;

  try {
    if (input.isMarketOpen && !(await input.isMarketOpen())) {
      return { status: "skipped", reason: "market_closed", job };
    }
    const availableUsdt = Number(balances.usdt);
    const reserved = await reservePocketJobSpend(storage, locks, pocket.address, amountUsdt, availableUsdt, utcDay);
    if (reserved.status === "inactive") return { status: "skipped", reason: "agent_stopped", job: reserved.job };
    if (reserved.status === "empty") return { status: "skipped", reason: "empty", job: reserved.job };
    if (reserved.status === "already_run") return { status: "skipped", reason: "already_run", job: reserved.job };
    if (reserved.status === "cap_reached") return { status: "skipped", reason: "cap_reached", job: reserved.job };
    reservation = reserved;

    const request = {
      mainAddress,
      sessionAddress: pocket.address,
      spender: pocket.address,
      receiver: pocket.address,
      job: reserved.job,
      side,
      tokenIn: side === "buy" ? "USDT" : "AAPLB",
      tokenOut: side === "buy" ? "AAPLB" : "USDT",
      amountIn: input.amountUsdt,
      amountUsdt,
    } as const;
    const availableBnb = Number(balances.bnb);
    if (!Number.isFinite(availableBnb) || availableBnb < 0.002) {
      const updatedJob = await releasePocketJobSpend(storage, locks, pocket.address, reserved);
      reservation = null;
      return { status: "skipped", reason: "insufficient_bnb_for_gas", job: updatedJob };
    }

    executionMayHaveStarted = true;
    const result = await executeGuardedTrade({
      ...request,
      sessionConfigured: true,
      capUsdt: reserved.job.capUsdt,
      spentUsdt: reserved.job.spentUsdt,
      reservedUsdt: reserved.job.reservedUsdt,
    }, helper, signer, config, input.canExecute);
    if (result.status === "executed") {
      const updatedJob = await commitPocketJobSpend(storage, locks, pocket.address, reserved);
      reservation = null;
      const record: SessionTradeRecord = {
        jobId: updatedJob.id,
        side,
        token: "AAPLB",
        amountUsdt,
        txHash: result.txHash,
        timestamp: Date.now(),
        source: "agent-session",
      };
      return { status: "executed", job: updatedJob, record };
    }
    if (result.status === "execution_unknown") {
      reservation = null;
      return { status: "execution_unknown", job: reserved.job, ...(result.errorCode ? { errorCode: result.errorCode } : {}) };
    }

    const updatedJob = await releasePocketJobSpend(storage, locks, pocket.address, reserved);
    reservation = null;
    return result.status === "rejected"
      ? { status: "rejected", reason: result.reason, ...(result.errorCode ? { errorCode: result.errorCode } : {}) }
      : { status: "failed", reason: result.reason, job: updatedJob, ...(result.errorCode ? { errorCode: result.errorCode } : {}) };
  } catch (error) {
    if (reservation) {
      if (executionMayHaveStarted) return { status: "execution_unknown", job: reservation.job };
      try {
        const updatedJob = await releasePocketJobSpend(storage, locks, pocket.address, reservation);
        return { status: "failed", reason: error instanceof Error ? error.message : "agent_tick_failed", job: updatedJob };
      } catch {
        return { status: "execution_unknown", job: reservation.job };
      }
    }
    return { status: "failed", reason: error instanceof Error ? error.message : "agent_tick_failed", job };
  }
}