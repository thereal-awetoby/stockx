import type { AgentTickResult } from "./types";

export type TickGateDenial = "tick_in_progress" | "previous_tick_unconfirmed";

export interface TickGate {
  /** Call before a tick. If `ok`, you MUST call `end` when it finishes. */
  begin(): { ok: true } | { ok: false; reason: TickGateDenial };
  end(status: AgentTickResult["status"]): void;
  /** Clears an unconfirmed result after the owner has checked the explorer. Never clears a running tick. */
  acknowledgeUnconfirmed(): void;
  readonly unconfirmed: boolean;
}

/**
 * One tick at a time, and no new tick after an `execution_unknown` result.
 * With spending limits off nothing else stops a second tick from buying again while the first
 * transaction is still unconfirmed, which is how a double buy happens.
 */
export function createTickGate(): TickGate {
  let running = false;
  let unconfirmed = false;
  return {
    begin() {
      if (running) return { ok: false, reason: "tick_in_progress" };
      if (unconfirmed) return { ok: false, reason: "previous_tick_unconfirmed" };
      running = true;
      return { ok: true };
    },
    end(status) {
      running = false;
      if (status === "execution_unknown") unconfirmed = true;
    },
    acknowledgeUnconfirmed() {
      unconfirmed = false;
    },
    get unconfirmed() {
      return unconfirmed;
    },
  };
}
