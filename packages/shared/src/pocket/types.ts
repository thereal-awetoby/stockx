import type { Signer, Wallet } from "ethers";
import type { SwapPipeline } from "../types";

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
  token: "AAPLB";
  amountUsdt: number;
  txHash: string;
  timestamp: number;
  source: "agent-session";
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
  amountIn: string;
  amountUsdt: number;
}

export type GuardedTradeStatus =
  | { status: "executed"; txHash: string }
  | { status: "rejected"; reason: string; errorCode?: string }
  | { status: "failed_before_execute"; reason: string; errorCode?: string }
  | { status: "execution_unknown"; errorCode?: string };

export type PocketSwapPipeline = SwapPipeline;

export type AgentTickResult =
  | { status: "executed"; job: Job; record: SessionTradeRecord }
  | { status: "rejected"; reason: string; errorCode?: string }
  | { status: "skipped"; reason: string; job?: Job; errorCode?: string }
  | { status: "failed"; reason: string; job?: Job; errorCode?: string }
  | { status: "execution_unknown"; job: Job; errorCode?: string };

export interface AgentRunLogEntry {
  timestamp: number;
  status: AgentTickResult["status"];
  message: string;
  errorCode?: string;
}