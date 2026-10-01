import type { Signer, Wallet } from "ethers";

export type SessionSigner = Wallet;
export type MainSigner = Signer;
export type AgentJobStatus = "active" | "stopped";
export type TradeSide = "buy" | "sell";

export interface Pocket {
  address: string;
  exported: boolean;
}

export interface PocketBalances {
  usdt: string;
  bnb: string;
}

export interface Job {
  id: string;
  capUsdt: number;
  spentUsdt: number;
  reservedUsdt: number;
  lastRunDay: string | null;
  status: AgentJobStatus;
}

export interface SessionTradeRecord {
  jobId: string;
  side: TradeSide;
  token: "AAPLx";
  amountUsdt: number;
  txHash: string;
  timestamp: number;
  source: "agent-session";
}

export interface SwapRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  spender: string;
  receiver: string;
}

export interface SwapHelper {
  quote(input: SwapRequest): Promise<unknown>;
  simulate(quote: unknown): Promise<boolean | { ok: boolean }>;
  execute(quote: unknown, receiver: string): Promise<{ hash?: string } | void>;
}

export interface PocketTradeRequest {
  mainAddress: string;
  sessionAddress: string;
  spender: string;
  receiver: string;
  job: Job;
  side: TradeSide;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountUsdt: number;
  approvalAmount: number;
}

export type GuardedTradeStatus =
  | { status: "executed"; txHash: string }
  | { status: "rejected"; reason: string }
  | { status: "failed_before_execute"; reason: string }
  | { status: "execution_unknown" };

export interface GuardedSwapExecutor {
  executeTrade(request: PocketTradeRequest, signer: SessionSigner): Promise<GuardedTradeStatus>;
  estimateGasBnb(request: PocketTradeRequest, signer: SessionSigner): Promise<number>;
}

export type SwapHelperFactory = (signer: SessionSigner) => SwapHelper;
export type ExactApproval = (tokenAddress: string, spender: string, amount: number, signer: SessionSigner) => Promise<void>;
export type GasEstimator = (request: PocketTradeRequest, signer: SessionSigner) => Promise<number>;

export type AgentTickResult =
  | { status: "executed"; job: Job; record: SessionTradeRecord }
  | { status: "rejected"; reason: string }
  | { status: "skipped"; reason: string; job?: Job }
  | { status: "failed"; reason: string; job?: Job }
  | { status: "execution_unknown"; job: Job };