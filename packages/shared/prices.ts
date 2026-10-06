export interface PriceSnapshot {
    /** Token price on BSC, in USD. */
    onchain: number;
    /** Real stock reference price, in USD. */
    reference: number;
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