import {
  AgentMainForbiddenError,
  NotSimulatedError,
  QuoteExpiredError,
  ReceiverMismatchError,
} from "./errors";
import type {
  Actor,
  Quote,
  QuoteRequest,
  SwapPipeline,
  SwapProvider,
  Wallet,
} from "./types";

export interface SwapHelperOptions {
  actor: Actor;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * The one swap pipeline. DIY and the agent both go through this.
 * Guards live here, not in the UI:
 *  - agent can never touch main (spender or receiver)
 *  - RFQ quotes are never used after expiry
 *  - execute only runs after a successful simulate of the SAME quote
 *  - execute receiver must equal the quote receiver
 */
export function createSwapHelper(
  provider: SwapProvider,
  opts: SwapHelperOptions,
): SwapPipeline {
  const now = opts.now ?? Date.now;
  const simulatedOk = new Set<string>();

  function assertActorRules(spender: Wallet, receiver: Wallet) {
    if (opts.actor === "agent" && (spender !== "session" || receiver !== "session")) {
      throw new AgentMainForbiddenError();
    }
  }

  function assertLive(q: Quote) {
    if (q.style === "rfq" && q.expiresAt !== undefined && now() >= q.expiresAt) {
      throw new QuoteExpiredError();
    }
  }

  return {
    async quote(req: QuoteRequest) {
      assertActorRules(req.spender, req.receiver);
      return provider.quote(req);
    },

    async simulate(q: Quote) {
      assertActorRules(q.request.spender, q.request.receiver);
      assertLive(q);
      const res = await provider.simulate(q);
      if (res.ok) simulatedOk.add(q.id);
      else simulatedOk.delete(q.id);
      return res;
    },

    async execute(q: Quote, receiver: Wallet) {
      assertActorRules(q.request.spender, receiver);
      if (receiver !== q.request.receiver) throw new ReceiverMismatchError();
      assertLive(q);
      if (!simulatedOk.has(q.id)) throw new NotSimulatedError();
      const res = await provider.execute(q, receiver);
      simulatedOk.delete(q.id); // one quote, one send
      return res;
    },
  };
}