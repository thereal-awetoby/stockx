import { RFQ_TTL_MS } from "./constants";
import type { Quote, QuoteRequest, SwapProvider } from "./types";

const MOCK_PRICE_USDT = 250; // 1 AAPLB = 250 USDT (fake)

let counter = 0;
const id = () => `mock_${Date.now()}_${++counter}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lets Builder B and the UI work before the real Binance Web3 provider exists. */
export function createMockProvider(): SwapProvider {
  return {
    async quote(req: QuoteRequest): Promise<Quote> {
      await sleep(150);
      const style = req.tokenOut.endsWith("on") ? "rfq" : "swap"; // Ondo tokens (AAPLon) => RFQ
      const issuedAt = Date.now();
      const out = Number(req.amountIn) / MOCK_PRICE_USDT;
      return {
        id: id(),
        style,
        request: req,
        amountOut: out.toFixed(6),
        issuedAt,
        expiresAt: style === "rfq" ? issuedAt + RFQ_TTL_MS : undefined,
      };
    },
    async simulate(q) {
      await sleep(150);
      if (!(Number(q.request.amountIn) > 0)) {
        return { ok: false, error: "Amount must be greater than 0" };
      }
      return { ok: true, gasEstimate: "180000" };
    },
    async execute(q, receiver) {
      await sleep(400);
      return { txHash: "0xmock" + q.id.replace(/\W/g, "").padEnd(58, "0").slice(0, 58), receiver };
    },
  };
}
