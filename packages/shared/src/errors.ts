export class SwapError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "SwapError";
  }
}
export class QuoteExpiredError extends SwapError {
  constructor() {
    super("QUOTE_EXPIRED", "RFQ quote expired. Get a new quote, never reuse.");
  }
}
export class AgentMainForbiddenError extends SwapError {
  constructor() {
    super("AGENT_MAIN_FORBIDDEN", "Agent may only use the session wallet, never main.");
  }
}
export class NotSimulatedError extends SwapError {
  constructor() {
    super("NOT_SIMULATED", "Simulate must succeed before execute.");
  }
}
export class ReceiverMismatchError extends SwapError {
  constructor() {
    super("RECEIVER_MISMATCH", "execute receiver must match the quote receiver.");
  }
}
