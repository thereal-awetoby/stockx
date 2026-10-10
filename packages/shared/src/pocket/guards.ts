import { agentLimitsOff, POCKET_CONFIG, type PocketConfig } from "./config";
import { SwapError } from "../errors";
import type { Quote, SwapPipeline } from "../types";
import type { GuardedTradeStatus, PocketTradeRequest, SessionSigner } from "./types";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
export const MAX_AGENT_TRADE_USDT = 5;

export interface PocketGuardInput extends PocketTradeRequest {
  sessionConfigured: boolean;
  capUsdt: number;
  spentUsdt: number;
  reservedUsdt: number;
}

export interface PocketGuardResult {
  allowed: boolean;
  reason?: string;
}

export function isSupportedStockRoute(
  side: "buy" | "sell",
  tokenIn: string,
  tokenOut: string,
): boolean {
  if (side === "buy") return tokenIn === "USDT" && tokenOut === "AAPLB";
  return tokenIn === "AAPLB" && tokenOut === "USDT";
}

function sameAddress(left: string, right: string): boolean {
  return ADDRESS_PATTERN.test(left) && ADDRESS_PATTERN.test(right) && left.toLowerCase() === right.toLowerCase();
}

export function evaluatePocketAction(input: PocketGuardInput, config: PocketConfig = POCKET_CONFIG): PocketGuardResult {
  if (input == null || typeof input !== "object") return { allowed: false, reason: "invalid_guard_input" };
  if (!input.sessionConfigured) return { allowed: false, reason: "not_configured" };
  if (!ADDRESS_PATTERN.test(input.mainAddress) || !ADDRESS_PATTERN.test(input.sessionAddress)) return { allowed: false, reason: "invalid_address" };
  if (sameAddress(input.mainAddress, input.sessionAddress)) return { allowed: false, reason: "session_must_differ_from_main" };
  if (!sameAddress(input.spender, input.sessionAddress)) return { allowed: false, reason: "spender_must_be_session" };
  if (!sameAddress(input.receiver, input.sessionAddress)) return { allowed: false, reason: "receiver_must_be_session" };
  if (!isSupportedStockRoute(input.side, input.tokenIn, input.tokenOut)) return { allowed: false, reason: "unsupported_token_route" };
  if (!DECIMAL_AMOUNT.test(input.amountIn) || !Number.isFinite(Number(input.amountIn)) || Number(input.amountIn) <= 0 ||
    !Number.isFinite(input.amountUsdt) || input.amountUsdt <= 0 || Number(input.amountIn) !== input.amountUsdt) {
    return { allowed: false, reason: "invalid_trade_amount" };
  }
  if (!agentLimitsOff() && input.amountUsdt > MAX_AGENT_TRADE_USDT) return { allowed: false, reason: "max_trade_exceeded" };
  if (!agentLimitsOff() && (!Number.isFinite(input.capUsdt) || input.capUsdt <= 0 || input.capUsdt > config.systemJobCapUsdt)) {
    return { allowed: false, reason: "invalid_job_cap" };
  }
  if (!Number.isFinite(input.spentUsdt) || input.spentUsdt < 0 || !Number.isFinite(input.reservedUsdt) || input.reservedUsdt < 0) {
    return { allowed: false, reason: "invalid_job_spend" };
  }
  if (!agentLimitsOff() && input.side === "buy" && input.spentUsdt + input.reservedUsdt + input.amountUsdt > input.capUsdt) {
    return { allowed: false, reason: "job_cap_exceeded" };
  }
  return { allowed: true };
}

function isValidQuote(quote: Quote, input: PocketTradeRequest): boolean {
  return quote.request.tokenIn === input.tokenIn &&
    quote.request.tokenOut === input.tokenOut &&
    quote.request.amountIn === input.amountIn &&
    quote.request.spender === "session" &&
    quote.request.receiver === "session";
}

function swapErrorCode(error: unknown): string | undefined {
  return error instanceof SwapError ? error.code : undefined;
}

export async function executeGuardedTrade(
  input: PocketGuardInput,
  helper: SwapPipeline | null,
  signer: SessionSigner,
  config: PocketConfig = POCKET_CONFIG,
  canExecute?: () => boolean | Promise<boolean>,
): Promise<GuardedTradeStatus> {
  if (!helper) return { status: "rejected", reason: "not_configured" };
  const guard = evaluatePocketAction(input, config);
  if (!guard.allowed) return { status: "rejected", reason: guard.reason ?? "guard_rejected" };
  try {
    if ((await signer.getAddress()).toLowerCase() !== input.sessionAddress.toLowerCase()) {
      return { status: "rejected", reason: "signer_must_be_session" };
    }
  } catch (error) {
    return {
      status: "failed_before_execute",
      reason: error instanceof Error ? error.message : "session_signer_unavailable",
      ...(swapErrorCode(error) ? { errorCode: swapErrorCode(error) } : {}),
    };
  }

  const request = {
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn,
    spender: "session" as const,
    receiver: "session" as const,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let executionStarted = false;
    try {
      const quote = await helper.quote(request);
      if (!isValidQuote(quote, input)) return { status: "failed_before_execute", reason: "invalid_quote" };
      const simulation = await helper.simulate(quote);
      if (!simulation.ok) {
        return { status: "failed_before_execute", reason: simulation.error ?? "simulation_failed" };
      }
      if (canExecute && !(await canExecute())) return { status: "rejected", reason: "kill_switch_active" };
      executionStarted = true;
      const result = await helper.execute(quote, "session");
      if (result.receiver !== "session") return { status: "execution_unknown", errorCode: "RECEIVER_MISMATCH" };
      return { status: "executed", txHash: result.txHash };
    } catch (error) {
      const errorCode = swapErrorCode(error);
      if (errorCode === "QUOTE_EXPIRED" && attempt < 2) continue;
      if (executionStarted && !errorCode) return { status: "execution_unknown" };
      return {
        status: "failed_before_execute",
        reason: error instanceof Error ? error.message : "swap_failed",
        ...(errorCode ? { errorCode } : {}),
      };
    }
  }

  return { status: "failed_before_execute", reason: "quote_expired", errorCode: "QUOTE_EXPIRED" };
}