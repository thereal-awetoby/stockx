import {
  commitPocketJobSpend,
  releasePocketJobSpend,
  reservePocketJobSpend,
  type PocketJobLock,
  type PocketJobStorage,
} from "./job-store";
import { POCKET_CONFIG, type PocketConfig } from "./config";
import type {
  AgentTickResult,
  GuardedSwapExecutor,
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
  helper: GuardedSwapExecutor | null;
  mainAddress: string;
  signer: SessionSigner;
  storage: PocketJobStorage;
  locks: PocketJobLock;
  balances: PocketBalances;
  amountUsdt: number;
  config?: PocketConfig;
}

export async function runAgentTick(input: RunAgentTickInput): Promise<AgentTickResult> {
  const { pocket, job, helper, mainAddress, signer, storage, locks, balances } = input;
  const config = input.config ?? POCKET_CONFIG;
  if (!helper || !config.aaplXAddress || !config.approvalSpenderAddress) return { status: "rejected", reason: "not_configured" };
  if (!pocket.exported) return { status: "rejected", reason: "backup_not_verified" };
  if (job.status !== "active") return { status: "skipped", reason: "agent_stopped", job };
  if (mainAddress.toLowerCase() === pocket.address.toLowerCase()) {
    return { status: "rejected", reason: "session_must_differ_from_main" };
  }
  if ((await signer.getAddress()).toLowerCase() !== pocket.address.toLowerCase()) {
    return { status: "rejected", reason: "signer_must_be_session" };
  }
  if (!Number.isFinite(input.amountUsdt) || input.amountUsdt <= 0) {
    return { status: "rejected", reason: "invalid_trade_amount" };
  }

  const side: TradeSide = "buy";
  const utcDay = new Date().toISOString().slice(0, 10);
  let reservation: Extract<Awaited<ReturnType<typeof reservePocketJobSpend>>, { status: "reserved" }> | null = null;
  let executionMayHaveStarted = false;

  try {
    const availableUsdt = Number(balances.usdt);
    const reserved = await reservePocketJobSpend(storage, locks, pocket.address, input.amountUsdt, availableUsdt, utcDay);
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
      tokenIn: side === "buy" ? config.usdtAddress : config.aaplXAddress,
      tokenOut: side === "buy" ? config.aaplXAddress : config.usdtAddress,
      amountIn: input.amountUsdt,
      amountUsdt: input.amountUsdt,
      approvalAmount: input.amountUsdt,
    } as const;
    const gasEstimate = await helper.estimateGasBnb(request, signer);
    const availableBnb = Number(balances.bnb);
    if (!Number.isFinite(gasEstimate) || gasEstimate <= 0 || !Number.isFinite(availableBnb) || availableBnb < gasEstimate) {
      const updatedJob = await releasePocketJobSpend(storage, locks, pocket.address, reserved);
      reservation = null;
      return { status: "skipped", reason: "insufficient_bnb_for_gas", job: updatedJob };
    }

    executionMayHaveStarted = true;
    const result = await helper.executeTrade(request, signer);
    if (result.status === "executed") {
      const updatedJob = await commitPocketJobSpend(storage, locks, pocket.address, reserved);
      reservation = null;
      const record: SessionTradeRecord = {
        jobId: updatedJob.id,
        side,
        token: "AAPLx",
        amountUsdt: input.amountUsdt,
        txHash: result.txHash,
        timestamp: Date.now(),
        source: "agent-session",
      };
      return { status: "executed", job: updatedJob, record };
    }
    if (result.status === "execution_unknown") {
      reservation = null;
      return { status: "execution_unknown", job: reserved.job };
    }

    const updatedJob = await releasePocketJobSpend(storage, locks, pocket.address, reserved);
    reservation = null;
    return result.status === "rejected"
      ? { status: "rejected", reason: result.reason }
      : { status: "failed", reason: result.reason, job: updatedJob };
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