/** Who holds the funds / receives the tokens. Nothing else is allowed. */
export type Wallet = "main" | "session";

/** Who is calling the helper. The agent is more restricted than the user. */
export type Actor = "user" | "agent";

/** Normal swap = sign and send. RFQ = quote that dies after ~30s. */
export type QuoteStyle = "swap" | "rfq";

export interface QuoteRequest {
  /** Symbol for now ("USDT", "AAPLx"). Swap to addresses when A2 lands. */
  tokenIn: string;
  tokenOut: string;
  /** Human decimal string, e.g. "5" or "12.5". Never a float. */
  amountIn: string;
  spender: Wallet;
  receiver: Wallet;
}

export interface Quote {
  id: string;
  style: QuoteStyle;
  request: QuoteRequest;
  amountOut: string;
  issuedAt: number;
  /** RFQ only. Epoch ms. */
  expiresAt?: number;
  /** Provider payload (needed later to build the tx). */
  raw?: unknown;
}

export interface SimulationResult {
  ok: boolean;
  error?: string;
  gasEstimate?: string;
  /** Real provider only: the swap cannot be dry-run until an exact approval is mined. */
  needsApproval?: boolean;
}

export interface ExecutionResult {
  txHash: string;
  receiver: Wallet;
}

/** What a real backend (Binance Web3) or the mock must implement. */
export interface SwapProvider {
  quote(req: QuoteRequest): Promise<Quote>;
  simulate(quote: Quote): Promise<SimulationResult>;
  execute(quote: Quote, receiver: Wallet): Promise<ExecutionResult>;
}

export interface SwapPipeline {
  quote(req: QuoteRequest): Promise<Quote>;
  simulate(quote: Quote): Promise<SimulationResult>;
  execute(quote: Quote, receiver: Wallet): Promise<ExecutionResult>;
}
