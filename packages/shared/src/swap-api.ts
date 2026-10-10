/** What the UI needs from a Binance aggregator quote (normalised by our /api/swap/quote route). */
export interface QuoteView {
    quoteId: string;
    executionMode: string;
    /** Decimal strings, already formatted (USDT in, token out). */
    amountIn: string;
    amountOut: string;
    priceImpactPercent: string;
    /** DEX names in route order, e.g. ["Kipseli", "Pancakeswap V3"]. */
    route: string[];
    approveTarget: string;
    /** Gas units estimated by the API. */
    gasEstimate: string;
    /** Epoch ms when our server received the quote. */
    quotedAt: number;
  }
  
  export async function fetchQuoteView(amount: string, wallet?: string, token = "AAPLB"): Promise<QuoteView> {
    const qs = new URLSearchParams({ amount, token });
    if (wallet) qs.set("wallet", wallet);
    const res = await fetch(`/api/swap/quote?${qs.toString()}`, { cache: "no-store" });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error ?? `Quote failed (HTTP ${res.status})`);
    return j as QuoteView;
  }