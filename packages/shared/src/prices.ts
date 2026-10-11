export interface PriceSnapshot {
    /** Token price on BSC, in USD. */
    onchain: number;
    /** Real stock reference price, in USD. null when the stock has no price right now (e.g. closed market, public fallback). */
    reference: number | null;
    /** Epoch ms. */
    asOf: number;
    /** "mock" until the real Binance Web3 source is wired in. Show it in the UI. */
    source: string;
  }
  
  export interface PriceProvider {
    getPrices(token: string): Promise<PriceSnapshot>;
  }
  
  /** Fake but moving numbers so the UI can be built and demoed. NOT real prices. */
  export function createMockPriceProvider(): PriceProvider {
    return {
      async getPrices() {
        await new Promise((r) => setTimeout(r, 200));
        const t = Date.now();
        const reference = 300 + Math.sin(t / 60_000) * 0.5;
        const premium = 0.004 + Math.sin(t / 45_000) * 0.002;
        return { onchain: reference * (1 + premium), reference, asOf: t, source: "mock" };
      },
    };
  }
  /** Real prices from the Binance RWA API, through our server route. `token` is the contract address. */
  export function createApiPriceProvider(baseUrl = ""): PriceProvider {
    return {
      async getPrices(token) {
        const res = await fetch(`${baseUrl}/api/rwa/price?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Prices unavailable (HTTP ${res.status})`);
        const j = (await res.json()) as { tokenPrice: number; referencePrice: number | null; updatedAt: number; source?: string };
        return { onchain: j.tokenPrice, reference: Number.isFinite(j.referencePrice) && (j.referencePrice ?? 0) > 0 ? j.referencePrice : null, asOf: j.updatedAt, source: j.source ?? "binance-rwa" };
      },
    };
  }

/**
 * Prices from Binance's PUBLIC "rwa/dynamic" endpoint (no API key, no signature), used when the signed
 * endpoint is unavailable (for example Binance refuses the server's location). tokenInfo.price is the
 * on-chain price; stockInfo.price is the US stock price, null outside trading hours. The reference is
 * returned per token (stock price x shares-per-token) so the premium compares like with like.
 */
export function priceFromDynamic(data: unknown): { tokenPrice: number; referencePrice: number | null } | null {
  const d = data as { tokenInfo?: { price?: unknown; sharesMultiplier?: unknown }; stockInfo?: { price?: unknown; previousClose?: unknown; prevClose?: unknown; closePrice?: unknown; lastClose?: unknown } } | null | undefined;
  const num = (v: unknown): number | null => {
    if (typeof v !== "string" && typeof v !== "number") return null;
    if (typeof v === "string" && v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const tokenPrice = num(d?.tokenInfo?.price);
  if (tokenPrice === null) return null;
  // Outside US trading hours Binance sends no live stock price. Use its own last close if it provides one.
  const si = d?.stockInfo;
  const stock = num(si?.price) ?? num(si?.previousClose) ?? num(si?.prevClose) ?? num(si?.closePrice) ?? num(si?.lastClose);
  const mult = num(d?.tokenInfo?.sharesMultiplier) ?? 1;
  return { tokenPrice, referencePrice: stock === null ? null : stock * mult };
}
