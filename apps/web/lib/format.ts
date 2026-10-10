/** One place for number formatting so every page shows "$1,234.56", never "US$1,234.56". */
export const usd = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const signedPct = (n: number, dp = 2): string => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(dp)}%`;
