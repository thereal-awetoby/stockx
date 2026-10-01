export type SignalStrategy = "momentum_breakout" | "mean_reversion";
export type SignalAction = "buy" | "sell" | "hold";

export interface PriceSignalInput {
  strategy: SignalStrategy;
  status: string;
  lastPrice: number;
  openPrice: number;
  thresholdPct?: number;
}

export interface PriceSignal {
  action: SignalAction;
  signalStrength: number;
  deviationPct: number | null;
  reason: string;
}

export function buildPriceSignal(input: PriceSignalInput): PriceSignal {
  if (input.status !== "live") {
    return { action: "hold", signalStrength: 0, deviationPct: null, reason: "market_data_unavailable" };
  }
  if (
    !Number.isFinite(input.lastPrice) ||
    !Number.isFinite(input.openPrice) ||
    input.lastPrice <= 0 ||
    input.openPrice <= 0
  ) {
    return { action: "hold", signalStrength: 0, deviationPct: null, reason: "invalid_market_prices" };
  }

  const thresholdPct = input.thresholdPct ?? 1;
  if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) {
    return { action: "hold", signalStrength: 0, deviationPct: null, reason: "invalid_threshold" };
  }

  const deviationPct = ((input.lastPrice - input.openPrice) / input.openPrice) * 100;
  if (Math.abs(deviationPct) < thresholdPct) {
    return { action: "hold", signalStrength: 0, deviationPct, reason: "within_threshold" };
  }

  const action: SignalAction = input.strategy === "momentum_breakout"
    ? deviationPct > 0 ? "buy" : "sell"
    : deviationPct > 0 ? "sell" : "buy";
  const signalStrength = Math.min(1, Math.abs(deviationPct) / (thresholdPct * 4));

  return {
    action,
    signalStrength: Number(signalStrength.toFixed(4)),
    deviationPct: Number(deviationPct.toFixed(4)),
    reason: input.strategy,
  };
}