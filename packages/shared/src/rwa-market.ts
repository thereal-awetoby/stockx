/** Market state of the underlying stock, from the Binance RWA API (via our /api/rwa/market route). */
export interface RwaMarketState {
    open: boolean;
    reasonCode: string | null;
    reasonMsg: string | null;
    nextOpenTime: string | number | null;
    nextCloseTime: string | number | null;
  }
  
  export async function getRwaMarket(tokenAddress: string, baseUrl = ""): Promise<RwaMarketState> {
    const res = await fetch(`${baseUrl}/api/rwa/market?token=${encodeURIComponent(tokenAddress)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Market status unavailable (HTTP ${res.status})`);
    return (await res.json()) as RwaMarketState;
  }