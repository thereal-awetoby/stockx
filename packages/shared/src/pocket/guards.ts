import { POCKET_CONFIG, type PocketConfig } from "./config";
import type { GuardedTradeStatus, PocketTradeRequest, SessionSigner, SwapHelper, ExactApproval } from "./types";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

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

export interface GuardedQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  spender: string;
  receiver: string;
  approvalSpender: string;
  createdAt: number;
}

export function isSupportedStockRoute(
  side: "buy" | "sell",
  tokenIn: string,
  tokenOut: string,
  config: PocketConfig = POCKET_CONFIG,
): boolean {
  if (!config.aaplXAddress || !ADDRESS_PATTERN.test(config.aaplXAddress)) return false;
  const usdt = config.usdtAddress;
  if (side === "buy") return tokenIn.toLowerCase() === usdt.toLowerCase() && tokenOut.toLowerCase() === config.aaplXAddress.toLowerCase();
  return tokenIn.toLowerCase() === config.aaplXAddress.toLowerCase() && tokenOut.toLowerCase() === usdt.toLowerCase();
}

function sameAddress(left: string, right: string): boolean {
  return ADDRESS_PATTERN.test(left) && ADDRESS_PATTERN.test(right) && left.toLowerCase() === right.toLowerCase();
}

export function evaluatePocketAction(input: PocketGuardInput, config: PocketConfig = POCKET_CONFIG): PocketGuardResult {
  if (input == null || typeof input !== "object") return { allowed: false, reason: "invalid_guard_input" };
  if (!input.sessionConfigured || !config.aaplXAddress || !config.approvalSpenderAddress || config.aaplXDecimals === null) {
    return { allowed: false, reason: "not_configured" };
  }
  if (!ADDRESS_PATTERN.test(input.mainAddress) || !ADDRESS_PATTERN.test(input.sessionAddress)) return { allowed: false, reason: "invalid_address" };
  if (sameAddress(input.mainAddress, input.sessionAddress)) return { allowed: false, reason: "session_must_differ_from_main" };
  if (!sameAddress(input.spender, input.sessionAddress)) return { allowed: false, reason: "spender_must_be_session" };
  if (!sameAddress(input.receiver, input.sessionAddress)) return { allowed: false, reason: "receiver_must_be_session" };
  if (!isSupportedStockRoute(input.side, input.tokenIn, input.tokenOut, config)) return { allowed: false, reason: "unsupported_token_route" };
  if (!Number.isFinite(input.amountIn) || input.amountIn <= 0 || !Number.isFinite(input.amountUsdt) || input.amountUsdt <= 0) {
    return { allowed: false, reason: "invalid_trade_amount" };
  }
  if (!Number.isFinite(input.approvalAmount) || input.approvalAmount < 0) return { allowed: false, reason: "invalid_approval_amount" };
  if (input.approvalAmount > input.amountIn) return { allowed: false, reason: "approval_above_notional" };
  if (input.approvalAmount !== input.amountIn) return { allowed: false, reason: "approval_must_match_trade_amount" };
  if (!Number.isFinite(input.capUsdt) || input.capUsdt <= 0 || input.capUsdt > config.systemJobCapUsdt) {
    return { allowed: false, reason: "invalid_job_cap" };
  }
  if (!Number.isFinite(input.spentUsdt) || input.spentUsdt < 0 || !Number.isFinite(input.reservedUsdt) || input.reservedUsdt < 0) {
    return { allowed: false, reason: "invalid_job_spend" };
  }
  if (input.side === "buy" && input.spentUsdt + input.reservedUsdt + input.amountUsdt > input.capUsdt) {
    return { allowed: false, reason: "job_cap_exceeded" };
  }
  return { allowed: true };
}

function isValidQuote(quote: unknown, input: PocketTradeRequest, config: PocketConfig, now: number): quote is GuardedQuote {
  if (quote == null || typeof quote !== "object") return false;
  const candidate = quote as Partial<GuardedQuote>;
  return candidate.tokenIn === input.tokenIn &&
    candidate.tokenOut === input.tokenOut &&
    candidate.amountIn === input.amountIn &&
    sameAddress(candidate.spender ?? "", input.sessionAddress) &&
    sameAddress(candidate.receiver ?? "", input.sessionAddress) &&
    sameAddress(candidate.approvalSpender ?? "", config.approvalSpenderAddress ?? "") &&
    Number.isFinite(candidate.createdAt) &&
    (candidate.createdAt as number) <= now &&
    now - (candidate.createdAt as number) <= config.quoteTtlMs;
}

export async function executeGuardedTrade(
  input: PocketGuardInput,
  helper: SwapHelper | null,
  signer: SessionSigner,
  approveExact: ExactApproval | null,
  config: PocketConfig = POCKET_CONFIG,
): Promise<GuardedTradeStatus> {
  if (!helper || !approveExact) return { status: "rejected", reason: "not_configured" };
  const guard = evaluatePocketAction(input, config);
  if (!guard.allowed) return { status: "rejected", reason: guard.reason ?? "guard_rejected" };

  let executionStarted = false;
  try {
    const request = {
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn,
      spender: input.sessionAddress,
      receiver: input.sessionAddress,
    };
    const quote = await helper.quote(request);
    if (!isValidQuote(quote, input, config, Date.now())) return { status: "failed_before_execute", reason: "invalid_or_stale_quote" };

    const simulated = await helper.simulate(quote);
    if (simulated !== true && (typeof simulated !== "object" || simulated === null || simulated.ok !== true)) {
      return { status: "failed_before_execute", reason: "simulation_failed" };
    }
    if (!isValidQuote(quote, input, config, Date.now())) return { status: "failed_before_execute", reason: "quote_changed_after_simulation" };
    await approveExact(input.tokenIn, quote.approvalSpender, input.approvalAmount, signer);
    if (!isValidQuote(quote, input, config, Date.now())) return { status: "failed_before_execute", reason: "quote_expired_after_approval" };
    executionStarted = true;
    const result = await helper.execute(quote, input.sessionAddress);
    if (!result?.hash) return { status: "execution_unknown" };
    return { status: "executed", txHash: result.hash };
  } catch (error) {
    return executionStarted
      ? { status: "execution_unknown" }
      : { status: "failed_before_execute", reason: error instanceof Error ? error.message : "helper_error" };
  }
}