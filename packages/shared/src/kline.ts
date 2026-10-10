/** Chart ranges. Binance returns at most 300 candles per request, so ALL is "up to 300 days". */
export type KlineRange = "1D" | "1W" | "1M" | "3M" | "ALL";

export const KLINE_RANGES: Record<KlineRange, { interval: string; limit: number }> = {
  "1D": { interval: "5m", limit: 288 },
  "1W": { interval: "1h", limit: 168 },
  "1M": { interval: "4h", limit: 180 },
  "3M": { interval: "12h", limit: 180 },
  ALL: { interval: "1d", limit: 300 },
};

export interface ChartPoint {
  /** Candle open time, ms. */
  t: number;
  /** Close price, USD. */
  c: number;
}

export interface ChartSeries {
  range: KlineRange;
  points: ChartPoint[];
  open: number;
  high: number;
  low: number;
  close: number;
  changePct: number;
}

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);

/**
 * Turns Binance's klineInfos ([openTime, open, high, low, close, reserved, closeTime] per candle)
 * into a chart series. Bad candles are dropped. Returns null when fewer than 2 usable candles remain.
 */
export function parseKlines(raw: unknown, range: KlineRange): ChartSeries | null {
  if (!Array.isArray(raw)) return null;
  const candles: { t: number; o: number; h: number; l: number; c: number }[] = [];
  for (const row of raw) {
    if (!Array.isArray(row)) continue;
    const [t, o, h, l, c] = [num(row[0]), num(row[1]), num(row[2]), num(row[3]), num(row[4])];
    if ([t, o, h, l, c].every(Number.isFinite) && c > 0) candles.push({ t, o, h, l, c });
  }
  if (candles.length < 2) return null;
  candles.sort((a, b) => a.t - b.t);
  const open = candles[0].o;
  const close = candles[candles.length - 1].c;
  return {
    range,
    points: candles.map((x) => ({ t: x.t, c: x.c })),
    open,
    high: Math.max(...candles.map((x) => x.h)),
    low: Math.min(...candles.map((x) => x.l)),
    close,
    changePct: open > 0 ? ((close - open) / open) * 100 : 0,
  };
}
