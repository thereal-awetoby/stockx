import { executeGuardedTrade } from "./guards";
import { POCKET_CONFIG } from "./config";
import type {
  ExactApproval,
  GasEstimator,
  GuardedSwapExecutor,
  PocketTradeRequest,
  SessionSigner,
  SwapHelper,
} from "./types";

export interface AHelperBindings {
  approvalSpenderAddress: string;
  bindHelper(config: typeof POCKET_CONFIG, signer: SessionSigner): SwapHelper;
  approveExact: ExactApproval;
  estimateGasBnb: GasEstimator;
}

export function createRealSwapHelper(
  config: typeof POCKET_CONFIG,
  signer: SessionSigner,
  bindings: AHelperBindings | null = null,
): GuardedSwapExecutor | null {
  if (!config.aaplXAddress || !config.approvalSpenderAddress || config.aaplXDecimals === null || !bindings) return null;
  if (config.approvalSpenderAddress.toLowerCase() !== bindings.approvalSpenderAddress.toLowerCase()) return null;
  const helper = bindings.bindHelper(config, signer);

  return {
    async executeTrade(request: PocketTradeRequest, sessionSigner: SessionSigner) {
      if ((await sessionSigner.getAddress()).toLowerCase() !== request.sessionAddress.toLowerCase()) {
        return { status: "rejected", reason: "signer_must_be_session" };
      }
      return executeGuardedTrade({
        ...request,
        sessionConfigured: true,
        capUsdt: request.job.capUsdt,
        spentUsdt: request.job.spentUsdt,
        reservedUsdt: request.job.reservedUsdt,
      }, helper, sessionSigner, bindings.approveExact, config);
    },
    async estimateGasBnb(request: PocketTradeRequest, sessionSigner: SessionSigner) {
      if ((await sessionSigner.getAddress()).toLowerCase() !== request.sessionAddress.toLowerCase()) {
        throw new Error("Gas estimate requires the session signer.");
      }
      return bindings.estimateGasBnb(request, sessionSigner);
    },
  };
}